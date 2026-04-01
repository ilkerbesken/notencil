/**
 * NcilFileManager - .ncil dosya formatı için kaydetme ve açma yöneticisi
 *
 * .ncil formatı: JSON içeriğini gzip ile sıkıştırılmış ikili dosya
 * Desteklenen araç tipleri:
 *   - pen, highlighter  → points dizisi (flat array ile optimize)
 *   - text              → htmlContent, fontSize, color, alignment, width, height
 *   - arrow / line      → start, end, curveControlPoint, styles
 *   - shapes            → rectangle, ellipse, triangle, trapezoid, star, diamond,
 *                         parallelogram, oval, heart, cloud
 *   - tape              → mode, pattern, points, customMask (canvas→base64)
 *   - table             → rows, cols, data, cellStyles, rowHeights, colWidths
 *   - sticker           → her sticker bir veya daha fazla alt obje içerir;
 *                         bunlar yukarıdaki tiplerin birleşimidir (group)
 *   - image             → src (base64 veya URL)
 *   - group             → children (recursive)
 */
class NcilFileManager {
    constructor(app) {
        this.app = app;
        this._pakoReady = false;
        this.exporter = new NcilExporter(app);
        this._ensurePako();
    }

    // ─────────────────────────────────────────────
    // Kaydetme (NcilExporter'a yönlendirildi)
    // ─────────────────────────────────────────────

    async saveAsNcil() {
        return this.exporter.saveAsNcil();
    }

    async createNcilDataFromCurrentState() {
        return this.exporter.createNcilDataFromCurrentState();
    }

    async createNcilBlob(content, boardName, boardId = null) {
        // Use NcilExporter to prepare the optimized content
        const serialized = await this.exporter.serializeContent(content, boardId);
        
        // Add metadata like version and savedAt
        const finalContent = {
            version: serialized.version || '2.1',
            format: 'ncil',
            savedAt: new Date().toISOString(),
            appVersion: APP_CONFIG.NAME,
            id: boardId || serialized.id,
            pages: serialized.pages || null,
            currentPageIndex: serialized.currentPageIndex !== undefined ? serialized.currentPageIndex : 0,
            pdfBase64: serialized.pdfBase64 || undefined
        };

        const jsonStr = JSON.stringify(finalContent);
        
        await this._waitForPako();
        if (typeof pako === 'undefined') {
            return new Blob([jsonStr], { type: 'application/json' });
        }

        const compressed = pako.gzip(jsonStr);
        const header = new TextEncoder().encode(APP_CONFIG.SIGNATURE || 'notencil!');
        const finalData = new Uint8Array(header.length + compressed.length);
        finalData.set(header);
        finalData.set(compressed, header.length);
        
        return new Blob([finalData], { type: APP_CONFIG.MIME_TYPE });
    }

    async serializeContent(content, boardId = null) {
        return this.exporter.serializeContent(content, boardId);
    }

    async saveTemplateAsNcil(template) {
        return this.exporter.saveTemplateAsNcil(template);
    }

    // ─────────────────────────────────────────────
    // Açma
    // ─────────────────────────────────────────────

    async openNcilFile() {
        await this._waitForPako();

        if (window.showOpenFilePicker) {
            try {
                const [fileHandle] = await window.showOpenFilePicker({
                    types: [{ 
                        description: `${APP_CONFIG.NAME} Notu (${APP_CONFIG.FILE_EXTENSION})`, 
                        accept: { [APP_CONFIG.MIME_TYPE]: [APP_CONFIG.FILE_EXTENSION] } 
                    }],
                    multiple: false
                });
                const file = await fileHandle.getFile();
                await this._loadFromFile(file);
                return;
            } catch (e) {
                if (e.name === 'AbortError') return;
                console.warn('[NcilFileManager] showOpenFilePicker başarısız, fallback kullanılıyor:', e);
            }
        }

        // Fallback: hidden input
        const input = document.getElementById('ncilInput');
        if (input) {
            input.onchange = async (e) => {
                const file = e.target.files[0];
                if (file) await this._loadFromFile(file);
                input.value = '';
            };
            input.click();
        }
    }

    async _loadFromFile(file) {
        await this._waitForPako();
        try {
            const arrayBuffer = await file.arrayBuffer();
            const uint8 = new Uint8Array(arrayBuffer);

            let jsonStr;
            const contentStart = new TextDecoder().decode(uint8.slice(0, 16));
            
            // Sadece yeni imzayı destekle
            const signatures = [APP_CONFIG.SIGNATURE, "notencil!"];
            let signatureLength = 0;
            let isImzali = false;

            for (const sig of signatures) {
                if (contentStart.startsWith(sig)) {
                    isImzali = true;
                    signatureLength = sig.length;
                    break;
                }
            }

            if (isImzali) {
                // Başlığı atla ve decompress et
                const dataOnly = uint8.slice(signatureLength);
                jsonStr = pako.inflate(dataOnly, { to: 'string' });
            } else {
                // Yanlış format
                Utils.showToast(window.i18n.t('invalid_file').replace('{extension}', APP_CONFIG.FILE_EXTENSION), 'error');
                return;
            }

            const content = JSON.parse(jsonStr);

            if (!content || (!content.pages && !content.objects)) {
                Utils.showToast(window.i18n.t('invalid_file').replace('{extension}', APP_CONFIG.FILE_EXTENSION), 'error');
                return;
            }

            // Sayfaları deserialize et
            let pages = content.pages;
            if (pages) {
                // Paralel olarak tüm sayfaları deserialize et
                pages = await Promise.all(
                    pages.map(async page => {
                        page.objects = await Promise.all(
                            (page.objects || []).map(obj => this._deserializeObject(obj))
                        );
                        return page;
                    })
                );
            } else if (content.objects) {
                // Eski format: tek sayfa
                const deserializedObjects = await Promise.all(
                    content.objects.map(obj => this._deserializeObject(obj))
                );
                pages = [{
                    id: Date.now(),
                    name: window.i18n.t('page_1'),
                    objects: deserializedObjects,
                    backgroundColor: 'white',
                    backgroundPattern: 'none',
                    thumbnail: null
                }];
            }

            const dashboard = this.app.dashboard || window.dashboard;
            if (!dashboard) {
                console.error('[NcilFileManager] Dashboard not found!');
                return;
            }

            console.log('[NcilFileManager] Loading file:', file.name);
            this._showToast(`📂 ${window.i18n.t('reading_file').replace('{filename}', file.name)}`);
            
            const boardName = file.name.replace(/\.ncil$/i, '') || window.i18n.t('imported_note');
            
            // Eğer dosyada bir ID varsa onu kullan (Cihazlar arası tutarlılık için)
            const boardId = content.id || 'ncil_' + Date.now();
            
            // Check if board already exists in current session to avoid duplicates during rapid opens
            let existingBoard = dashboard.boards.find(b => b.id === boardId);
            
            let board;
            if (existingBoard) {
                board = existingBoard;
            } else {
                const hasPDF = !!content.pdfBase64;
                board = {
                    id: boardId,
                    name: boardName,
                    createdAt: Date.now(),
                    lastModified: Date.now(),
                    coverBg: hasPDF ? '#fa5252' : '#1971c2',
                    coverTexture: 'dots',
                    folderId: (dashboard.currentView && dashboard.currentView.startsWith('f_')) ? dashboard.currentView : null,
                    deleted: false,
                    isNcilFile: true,
                    isPDF: hasPDF
                };

                dashboard.boards.push(board);
                await dashboard.saveDataAsync('wb_boards', dashboard.boards);

                // PDF base64 verisi varsa IndexedDB'ye kaydet
                if (hasPDF) {
                    try {
                         const pdfBlob = await this._base64ToBlob(content.pdfBase64, 'application/pdf');
                         await Utils.db.save(board.id, pdfBlob);
                         console.log('[NcilFileManager] PDF verisi geri yüklendi.');
                    } catch (e) {
                         console.warn('[NcilFileManager] PDF verisi geri yüklenemedi:', e);
                    }
                }

                const contentToSave = {
                    version: content.version || '2.1',
                    pages: pages,
                    currentPageIndex: content.currentPageIndex !== undefined ? content.currentPageIndex : 0,
                    objects: pages ? null : []
                };

                await dashboard.saveDataAsync(`wb_content_${board.id}`, contentToSave);
                
                // Sync metadata'yı güncelle (Drive PUSH'u tetiklemek için)
                if (window.fileSystemManager) {
                    await window.fileSystemManager.updateSyncMetadata(board.id);
                }
            }

            // Dashboard → App geçişi and Tab Management is handled by dashboard.loadBoard
            console.log('[NcilFileManager] Transitioning to board:', board.id);
            this._showToast(`📂 "${board.name}" açıldı`);
            
            // Give a tiny bit of time for storage to settle and UI to be ready
            setTimeout(async () => {
                try {
                    await dashboard.loadBoard(board.id);
                    console.log('[NcilFileManager] loadBoard completed for:', board.id);
                } catch (loadErr) {
                    console.error('[NcilFileManager] loadBoard failed:', loadErr);
                    // Fallback manual transition if loadBoard fails
                    dashboard.container.style.display = 'none';
                    dashboard.appContainer.style.display = 'flex';
                    window.dispatchEvent(new Event('resize'));
                    if (this.app.tabManager) {
                        await this.app.tabManager.openBoard(board.id, board.name);
                    }
                }
            }, 100);

        } catch (err) {
            console.error('[NcilFileManager] Error in _loadFromFile:', err);
            Utils.showToast('Dosya açılamadı: ' + err.message, 'error');
        }
    }

    // ─────────────────────────────────────────────
    // Yardımcı Fonksiyonlar
    // ─────────────────────────────────────────────

    async _ensurePako() {
        if (typeof pako !== 'undefined') { this._pakoReady = true; return; }
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js';
            script.onload = () => { this._pakoReady = true; console.log('[NcilFileManager] pako yüklendi.'); resolve(); };
            script.onerror = () => { console.error('[NcilFileManager] pako yüklenemedi!'); reject(new Error('pako yüklenemedi')); };
            document.head.appendChild(script);
        });
    }

    async _waitForPako() {
        if (this._pakoReady) return;
        await this._ensurePako();
        let attempts = 0;
        while (typeof pako === 'undefined' && attempts < 50) {
            await new Promise(r => setTimeout(r, 100));
            attempts++;
        }
        if (typeof pako === 'undefined') throw new Error('pako kütüphanesi yüklenemedi');
    }

    /**
     * base64 PNG → HTMLImageElement (Promise)
     */
    async _deserializeObject(obj) {
        if (!obj) return obj;

        // ── Grup: recursive ──
        if (obj.type === 'group') {
            obj.children = await Promise.all(
                (obj.children || []).map(child => this._deserializeObject(child))
            );
            return obj;
        }

        // ── Kalem / Vurgulayıcı: flat array → [{x,y,pressure},...] ──
        if ((obj.type === 'pen' || obj.type === 'highlighter') && obj._flat && Array.isArray(obj.points)) {
            const inflated = [];
            for (let i = 0; i < obj.points.length; i += 3) {
                inflated.push({
                    x: obj.points[i],
                    y: obj.points[i + 1],
                    pressure: obj.points[i + 2] !== undefined ? obj.points[i + 2] : 0.5
                });
            }
            obj.points = inflated;
            delete obj._flat;
        }

        // ── Bant (Tape): flat points + customMask/customImage ──
        if (obj.type === 'tape') {
            // Points flat array → [{x,y},...] (bant için pressure yok)
            if (obj._flat && Array.isArray(obj.points)) {
                const inflated = [];
                for (let i = 0; i < obj.points.length; i += 2) {
                    inflated.push({ x: obj.points[i], y: obj.points[i + 1] });
                }
                obj.points = inflated;
                delete obj._flat;
            }

            // customMask: base64 → HTMLImageElement (TapeTool bunu kullanabilir)
            if (obj.customMask && typeof obj.customMask === 'object' && obj.customMask._type === 'canvas_b64') {
                obj.customMask = await this._loadImageFromBase64(obj.customMask.data);
            }

            if (obj.customImage && typeof obj.customImage === 'object' && obj.customImage._type === 'canvas_b64') {
                obj.customImage = await this._loadImageFromBase64(obj.customImage.data);
            }
        }

        // ── Tablo (Table): önbellek başlat ──
        if (obj.type === 'table') {
            // _cellCaches runtime — boş olarak başlat
            obj._cellCaches = {};

            // cellStyles eksik satır/sütunları tamamla
            if (!Array.isArray(obj.cellStyles) || obj.cellStyles.length !== obj.rows) {
                obj.cellStyles = Array(obj.rows).fill(null).map((_, r) => {
                    const existingRow = (obj.cellStyles && obj.cellStyles[r]) ? obj.cellStyles[r] : [];
                    return Array(obj.cols).fill(null).map((__, c) => existingRow[c] || {});
                });
            }

            // rowHeights / colWidths eksikse varsayılan değer ver
            if (!Array.isArray(obj.rowHeights) || obj.rowHeights.length !== obj.rows) {
                obj.rowHeights = Array(obj.rows).fill(40);
            }
            if (!Array.isArray(obj.colWidths) || obj.colWidths.length !== obj.cols) {
                obj.colWidths = Array(obj.cols).fill(100);
            }

            // data eksik hücreleri tamamla
            if (!Array.isArray(obj.data)) {
                obj.data = Array(obj.rows).fill(null).map(() => Array(obj.cols).fill(''));
            }

            // width / height hesapla (eğer eksikse)
            if (!obj.width) obj.width = obj.colWidths.reduce((a, b) => a + b, 0);
            if (!obj.height) obj.height = obj.rowHeights.reduce((a, b) => a + b, 0);
        }

        // ── Metin (Text): eksik alanları tamamla ──
        if (obj.type === 'text') {
            obj.htmlContent = obj.htmlContent || obj.content || '';
            obj.fontSize = obj.fontSize || 12;
            obj.color = obj.color || '#000000';
            obj.width = obj.width || 200;
            obj.height = obj.height || 40;
        }

        // ── Ok / Çizgi: eksik alanları tamamla ──
        if (obj.type === 'arrow' || obj.type === 'line') {
            // Eski format geriye dönük uyumluluk
            if (!obj.start && obj.x1 !== undefined) {
                obj.start = { x: obj.x1, y: obj.y1 };
                obj.end = { x: obj.x2, y: obj.y2 };
            }
        }

        return obj;
    }

    /**
     * base64 PNG → HTMLImageElement (Promise)
     */
    _loadImageFromBase64(dataUrl) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => {
                // Yüklenemezse null döndür
                console.warn('[NcilFileManager] Resim yüklenemedi.');
                resolve(null);
            };
            img.src = dataUrl;
        });
    }

    /**
     * Blob → base64 data URL (Promise)
     */
    _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * base64 data URL → Blob
     */
    async _base64ToBlob(dataUrl, mimeType) {
        // dataUrl may start with 'data:application/pdf;base64,...'
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        const binaryStr = atob(base64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        return new Blob([bytes], { type: mimeType || 'application/pdf' });
    }

    // ─────────────────────────────────────────────
    // Toast Bildirimi
    // ─────────────────────────────────────────────

    _showToast(message) {
        Utils.showToast(message, message.includes('✅') || message.includes('📂') ? 'success' : 'info');
    }
}
