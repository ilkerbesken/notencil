/**
 * notencil - Cloud Storage Manager
 * Drive = Source of Truth Implementation.
 * No redundant creations, strict matching by name and hierarchy.
 */

class CloudStorageManager {
    static detect() {
        const ua = navigator.userAgent;
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
        const isChrome = /Chrome/.test(ua) && /Google Inc/.test(navigator.vendor);
        const isPWA = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
        return { isMobile, isChrome, isPWA };
    }

    constructor(app) {
        this.app = app;
        this.GOOGLE_CLIENT_ID = '915367935470-foe1s3qi94pstohb7p2svpbeu2v3oe66.apps.googleusercontent.com';
        this.GOOGLE_SCOPES = 'https://www.googleapis.com/auth/drive';
        this.DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest';
        
        this.gisLoaded = false;
        this.gapiLoaded = false;
        this.gdriveToken = localStorage.getItem(`${APP_CONFIG.STORAGE_PREFIX}gdrive_token`);
        this.isSyncing = false;
        this.fsm = window.fileSystemManager;
        
        this._activeSyncs = new Set();
        this._syncQueue = []; // Bekleyen işlemler kuyruğu
        this._isQueueProcessing = false;
    }

    // ─── Google API & Identity Services ──────────────────────────
    async init() {
        if (this.gisLoaded) return;
        await this._loadScript('https://accounts.google.com/gsi/client');
        this.gisLoaded = true;
        console.log('[CloudSync] Google Identity Services hazır.');
    }

    _loadScript(src) {
        return new Promise((resolve, reject) => {
            if (document.querySelector(`script[src="${src}"]`)) return resolve();
            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.defer = true;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Script yüklenemedi: ${src}`));
            document.head.appendChild(script);
        });
    }

    async signInGoogle() {
        await this.init();
        return new Promise((resolve, reject) => {
            // eslint-disable-next-line no-undef
            const client = google.accounts.oauth2.initTokenClient({
                client_id: this.GOOGLE_CLIENT_ID,
                scope: this.GOOGLE_SCOPES,
                callback: (r) => {
                    if (r.error) return reject(new Error(r.error));
                    this.gdriveToken = r.access_token;
                    localStorage.setItem(`${APP_CONFIG.STORAGE_PREFIX}gdrive_token`, r.access_token);
                    resolve(r.access_token);
                },
            });
            client.requestAccessToken();
        });
    }

    async _ensureToken() { 
        if (!this.gdriveToken) await this.signInGoogle(); 
    }

    /**
     * Ana Senkronizasyon Akışı.
     * Artık tam tarama yapmaz, sadece değişiklikleri ve kuyruğu işler.
     */
    async syncWithGoogleDrive(targetId = null) {
        if (this.isSyncing && !targetId) return { success: false, message: 'Senkronizasyon zaten sürüyor.' };
        if (targetId && this._activeSyncs?.has(targetId)) return { success: false, message: 'Öğe zaten senkronize ediliyor.' };
        
        if (targetId) this._activeSyncs.add(targetId); else this.isSyncing = true;

        try {
            await this._ensureToken();
            const fsm = window.fileSystemManager;

            // 1. ADIM: Temel Klasörleri Bul (Hızlı)
            const appFolderId = await this._getOrCreateDriveFolderMinimal(APP_CONFIG.GDRIVE_FOLDER, null);
            const settingsFolderId = await this._getOrCreateDriveFolderMinimal('.settings', appFolderId);

            let syncCount = 0;

            // 2. ADIM: Downstream (Drive -> Local)
            let remoteManifest = await this._pullManifest(settingsFolderId);
            let isDiscoveryMode = false;

            // Eğer manifest yoksa ama yerel boşsa, Drive'ı "Keşfet" (Eski sürümlerden geçiş için)
            if (!remoteManifest && targetId === null) {
                const localBoards = await fsm.getItem('wb_boards', []);
                if (localBoards.length === 0) {
                    console.log('[CloudSync] Manifest bulunamadı, derin keşif başlatılıyor...');
                    remoteManifest = await this._reconstructManifestByDiscovery(appFolderId);
                    isDiscoveryMode = true;
                }
            }

            if (remoteManifest) {
                syncCount += await this._mergeRemoteChanges(remoteManifest, appFolderId, isDiscoveryMode);
            }

            // 3. ADIM: Upstream (Local -> Drive)
            // Discovery sırasında upstream atlanır (çünkü yerel boş kabul edildi)
            if (!isDiscoveryMode) {
                syncCount += await this._pushLocalChanges(appFolderId);
            }

            // 4. ADIM: Manifest Update (Eğer değişiklik varsa)
            if (syncCount > 0) {
                await this._syncManifest(settingsFolderId);
            }

            return { success: true, message: syncCount > 0 ? `${syncCount} değişiklik işlendi.` : 'Her şey güncel.', syncCount };

        } catch (err) {
            console.error('[CloudSync] Hata:', err);
            return { success: false, message: err.message };
        } finally {
            if (targetId) this._activeSyncs.delete(targetId); else this.isSyncing = false;
        }
    }

    async _pullManifest(settingsFolderId) {
        try {
            const q = `name='${APP_CONFIG.MANIFEST_FILE}' and '${settingsFolderId}' in parents and trashed=false`;
            const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' });
            const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            const data = await res.json();
            const file = data.files?.[0];
            if (!file) return null;

            const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            if (!contentRes.ok) return null;
            return await contentRes.json();
        } catch (e) {
            console.warn('[CloudSync] Manifest çekilemedi:', e);
            return null;
        }
    }

    async _mergeRemoteChanges(remoteManifest, appFolderId, isDiscoveryMode = false) {
        let count = 0;
        const fsm = window.fileSystemManager;
        const localBoards = await fsm.getItem('wb_boards', []);
        const localFolders = await fsm.getItem('wb_folders', []);
        const deletedIds = await fsm.getItem('wb_deleted_ids', []);

        // Klasörleri güncelle
        for (const rf of (remoteManifest.folders || [])) {
            if (deletedIds.includes(rf.id)) continue;
            const idx = localFolders.findIndex(f => f.id === rf.id);
            if (idx === -1) { localFolders.push(rf); count++; }
            else if (rf.name !== localFolders[idx].name) { localFolders[idx].name = rf.name; count++; }
        }

        // Boardları güncelle (Sadece daha yeniyse indir)
        for (const rb of (remoteManifest.boards || [])) {
            if (deletedIds.includes(rb.id)) continue;
            const lb = localBoards.find(b => b.id === rb.id);
            const meta = await fsm.getSyncMetadata(rb.id);
            
            let needsPull = false;
            // Discovery modundaysak veya yerelde yoksa mutlaka indir
            if (!lb) {
                if (!deletedIds.includes(rb.id) && (!meta?.googleDriveFileId || isDiscoveryMode)) needsPull = true;
            } 
            else if (rb.lastModified > (lb.lastModified || 0)) {
                needsPull = true;
            }

            if (needsPull) {
                const content = await this._downloadBoardById(rb.id, rb.googleDriveFileId || meta?.googleDriveFileId);
                if (content) {
                    if (content._isRawPDF) {
                        // Ham PDF ise Blob'u IndexedDB'ye kaydet
                        await Utils.db.save(rb.id, content.blob);
                        // Minimal bir board içeriği oluştur
                        const minimal = { version: "2.1", pages: [], pdfBase64: null, objects: [] };
                        await fsm.saveItem(`wb_content_${rb.id}`, minimal, true);
                        rb.isPDF = true;
                        rb.alwaysSaveAsPDF = true;
                    } else {
                        await fsm.saveItem(`wb_content_${rb.id}`, content, true);
                        
                        // Eğer içerikte gömülü PDF varsa onu da ayıklayıp DB'ye kaydet
                        if (content.pdfBase64 && this.app.ncilFileManager) {
                            try {
                                const pdfBlob = await this.app.ncilFileManager._base64ToBlob(content.pdfBase64, 'application/pdf');
                                if (pdfBlob) {
                                    await Utils.db.save(rb.id, pdfBlob);
                                    rb.isPDF = true; // Meta veriyi doğrula
                                    console.log('[CloudSync] Gömülü PDF başarıyla ayıklandı ve DB\'ye kaydedildi:', rb.id);
                                }
                            } catch (e) {
                                console.error('[CloudSync] PDF ayıklama hatası:', e);
                            }
                        }
                    }
                    const idx = localBoards.findIndex(b => b.id === rb.id);
                    if (idx !== -1) localBoards[idx] = rb; else localBoards.push(rb);
                    count++;
                }
            }
            
            // Drive ID'sini mühürle
            if (isDiscoveryMode && rb.googleDriveFileId) {
                // SADECE ham kaynak değilse ID'yi mühürle. 
                // Ham kaynaksa ID mühürlenmezse ilk push yeni dosya (.ncil) oluşturur, orijinal PDF korunur.
                const syncId = rb.isRawSource ? null : rb.googleDriveFileId;
                await fsm.setSyncMetadata(rb.id, { googleDriveFileId: syncId, lastSyncedTime: Date.now() });
            }
        }

        if (count > 0) {
            await fsm.saveItem('wb_boards', localBoards, true);
            await fsm.saveItem('wb_folders', localFolders, true);
        }
        return count;
    }

    async _pushLocalChanges(appFolderId) {
        let count = 0;
        const fsm = window.fileSystemManager;
        const boards = await fsm.getItem('wb_boards', []);
        const folders = await fsm.getItem('wb_folders', []);
        
        // 1. Önce "kirli" klasörleri Drive'da oluştur/güncelle
        // (Bu kısım için robust bir mapping tutmak hala önemli)
        const driveFolderMapping = await this._ensureDriveFoldersRobust(folders, appFolderId);

        // 2. "Kirli" boardları bul ve gönder
        for (const board of boards) {
            const meta = await fsm.getSyncMetadata(board.id);
            if (!meta) continue;

            const needsPush = !meta.googleDriveFileId || (meta.lastModifiedLocally > (meta.lastSyncedTime || 0));
            if (needsPush) {
                let content = await fsm.getItem(`wb_content_${board.id}`, null);
                if (content) {
                    // Drive'a gönderirken eğer PDF ise ve base64 yoksa, DB'den çekip ekle
                    // Çünkü diğer cihazlarda bu PDF olmayabilir.
                    if (board.isPDF && !content.pdfBase64) {
                        const pdfBlob = await Utils.db.get(board.id);
                        if (pdfBlob && pdfBlob instanceof Blob) {
                            if (this.app.ncilFileManager) {
                                content.pdfBase64 = await this.app.ncilFileManager._blobToBase64(pdfBlob);
                            }
                        }
                    }

                    const targetParentId = board.folderId ? driveFolderMapping[board.folderId] : appFolderId;
                    const driveFileId = await this._uploadBoardNcil(board, content, folders, appFolderId, meta.googleDriveFileId);
                    await fsm.setSyncMetadata(board.id, { googleDriveFileId: driveFileId, lastSyncedTime: Date.now() });
                    count++;
                }
            }
        }
        return count;
    }

    async _downloadBoardById(boardId, driveId) {
        if (!driveId) {
            const q = `trashed=false and appProperties has { key='boardId' and value='${boardId}' }`;
            const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' });
            const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            const data = await res.json();
            driveId = data.files?.[0]?.id;
        }

        if (!driveId) return null;

        try {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            const arrayBuffer = await res.arrayBuffer();
            return await this._inflateNcilData(arrayBuffer);
        } catch (e) {
            console.error('[CloudSync] İndirme hatası:', boardId, e);
            return null;
        }
    }

    async _inflateNcilData(raw) {
        // GAPI result body can be a string or arraybuffer depending on transport
        // we'll use a robust check
        let uint8;
        if (typeof raw === 'string') {
            uint8 = new TextEncoder().encode(raw);
        } else {
            uint8 = new Uint8Array(raw);
        }

        const sig = APP_CONFIG.SIGNATURE || 'notencil!!';
        const isSigned = Array.from(uint8.slice(0, sig.length)).map(b => String.fromCharCode(b)).join('') === sig;
        if (isSigned) {
            try {
                if (!window.pako) {
                    await this._loadScript('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');
                }
                const decompressed = window.pako.inflate(uint8.slice(sig.length), { to: 'string' });
                return JSON.parse(decompressed);
            } catch (e) {
                console.error('[CloudSync] Ncil açma hatası:', e);
                return null;
            }
        }

        // Ham PDF kontrolü
        const head = new TextDecoder().decode(uint8.slice(0, 5));
        if (head === '%PDF-') {
            return { _isRawPDF: true, blob: new Blob([uint8], { type: 'application/pdf' }) };
        }

        try {
            return JSON.parse(new TextDecoder().decode(uint8));
        } catch (e) {
            return null;
        }
    }

    // ─── Klasör Yönetimi (Yeni Robust Mantık) ──────────────────────
    
    async _getOrCreateDriveFolderMinimal(name, parentId) {
        const q = `name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false${parentId ? ` and '${parentId}' in parents` : ''}`;
        const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' });
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
            headers: { Authorization: `Bearer ${this.gdriveToken}` }
        });
        const data = await res.json();
        if (data.files?.[0]) return data.files[0].id;

        const body = { name, mimeType: 'application/vnd.google-apps.folder', parents: parentId ? [parentId] : [] };
        const cRes = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.gdriveToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const f = await cRes.json();
        return f.id;
    }

    async _findOrCreateFolderInList(name, parentId, folderId) {
        const q = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' });
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
            headers: { Authorization: `Bearer ${this.gdriveToken}` }
        });
        const data = await res.json();
        if (data.files?.[0]) return data.files[0].id;

        const body = { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId], appProperties: { folderId, type: 'folder' } };
        const cRes = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.gdriveToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const f = await cRes.json();
        return f.id;
    }

    // ─── Diğer Yardımcı Metotlar ──────────────────────────────────
    async _syncManifest(folderId) {
        const manifest = { 
            version: 2, 
            syncedAt: new Date().toISOString(), 
            boards: await this.fsm.getItem('wb_boards', []), 
            folders: await this.fsm.getItem('wb_folders', []), 
            viewSettings: await this.fsm.getItem('wb_view_settings', {}) 
        };
        
        const q = `name='${APP_CONFIG.MANIFEST_FILE}' and '${folderId}' in parents and trashed=false`;
        const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' });
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
            headers: { Authorization: `Bearer ${this.gdriveToken}` }
        });
        const data = await res.json();
        const existingId = data.files?.[0]?.id;

        await this._uploadRawToDrive(APP_CONFIG.MANIFEST_FILE, new TextEncoder().encode(JSON.stringify(manifest, null, 2)), 'application/json', folderId, existingId);
    }

    async _uploadRawToDrive(name, bytes, mime, folderId, existingId, appProps = {}) {
        // Multipart upload GAPI client'da biraz karmaşık olduğu için manual fetch (v3) kullanmaya devam ediyoruz
        // Ancak token'ı GAPI'den alıyoruz
        const metadata = existingId ? { name, appProperties: appProps } : { name, parents: [folderId], appProperties: appProps };
        const url = existingId ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart` : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
        
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([bytes], { type: mime }));
        
        const res = await fetch(url, { 
            method: existingId ? 'PATCH' : 'POST', 
            headers: { Authorization: `Bearer ${this.gdriveToken}` }, 
            body: form 
        });
        const r = await res.json(); 
        return r.id;
    }

    async _uploadBoardNcil(board, content, folders, appFolderId, existingId) {
        const targetId = board.folderId ? await this._getDriveTargetFolderRobust(board.folderId, folders, appFolderId) : appFolderId;
        const bytes = await this._contentToNcil(content, board.id);
        const name = board.isPDF ? `${board.name}.pdf.ncil` : `${board.name}.ncil`; 
        const type = board.isPDF ? 'pdf' : 'board';
        return await this._uploadRawToDrive(name, bytes, APP_CONFIG.MIME_TYPE, targetId, existingId, { boardId: board.id, type: type });
    }

    async _getDriveTargetFolderRobust(folderId, folders, appFolderId) {
        const path = []; let curr = folderId;
        while (curr) { 
            const f = folders.find(x => x.id === curr); 
            if (!f) break; 
            path.unshift(f); 
            curr = f.parentId; 
        }
        let pId = appFolderId;
        for (const f of path) pId = await this._findOrCreateFolderInList(f.name, pId, f.id);
        return pId;
    }

    async _garbageCollect(appFId, boards, folders, delIds, settingsFolderId) {
        if (delIds.length === 0) return;
        
        for (const id of delIds) {
            try {
                const q = `appProperties has { key='boardId' and value='${id}' } or appProperties has { key='folderId' and value='${id}' }`;
                const params = new URLSearchParams({ q, fields: 'files(id)' });
                const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
                    headers: { Authorization: `Bearer ${this.gdriveToken}` }
                });
                const data = await res.json();
                for (const file of (data.files || [])) {
                    await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
                        method: 'DELETE',
                        headers: { Authorization: `Bearer ${this.gdriveToken}` }
                    });
                    console.log('[CloudSync] Drive\'dan silindi:', id);
                }
            } catch (e) {
                console.warn('[CloudSync] GC hatası:', id, e);
            }
        }
    }

    async _ensureDriveFoldersRobust(folders, appFolderId) {
        const mapping = {};
        for (const f of folders) {
            // Her klasör için Drive ID'si bul veya oluştur (Hiyerarşik olarak)
            mapping[f.id] = await this._getDriveTargetFolderRobust(f.id, folders, appFolderId);
        }
        return mapping;
    }

    async _reconstructManifestByDiscovery(appFolderId, logicalParentId = null) {
        const boards = [];
        const folders = [];
        
        try {
            const q = `'${appFolderId}' in parents and trashed=false`;
            const params = new URLSearchParams({ q, fields: 'files(id, name, appProperties, parents, mimeType, modifiedTime)', pageSize: '1000' });
            const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            const data = await res.json();
            const driveFiles = data.files || [];
            console.log(`[CloudSync] Discovery Tarama: ${appFolderId} klasöründe ${driveFiles.length} eleman bulundu.`);

            // 1. Klasörleri Ayıkla
            for (const f of driveFiles.filter(x => x.mimeType === 'application/vnd.google-apps.folder')) {
                if (f.name === '.settings') continue;
                
                // Dashboard.js "f_" ön eki beklediği için eğer yoksa ekliyoruz
                let fId = f.appProperties?.folderId || f.id;
                if (!fId.startsWith('f_')) fId = 'f_' + fId;

                folders.push({ id: fId, name: f.name, parentId: logicalParentId, color: '#616161' });
                
                // Recursive Discovery for this folder
                const subRes = await this._reconstructManifestByDiscovery(f.id, fId);
                boards.push(...subRes.boards);
                folders.push(...subRes.folders);
            }

        // 2. Boardları Ayıkla
            for (const f of driveFiles.filter(x => x.mimeType !== 'application/vnd.google-apps.folder')) {
                const isPDFFilename = f.name.toLowerCase().endsWith('.pdf');
                const isNcilFilename = f.name.toLowerCase().endsWith('.ncil');
                const isPDFNcil = f.name.toLowerCase().includes('.pdf.ncil');
                
                if (!isPDFFilename && !isNcilFilename) continue;
                
                // Dashboard.js "b_" ön eki beklediği için eğer yoksa ekliyoruz
                let bId = f.appProperties?.boardId || f.id;
                const isRawSource = !f.appProperties?.boardId; // Eğer boardId yoksa bu Drive'daki ham bir dosyadır
                if (!bId.startsWith('b_')) bId = 'b_' + bId;

                console.log(`[CloudSync] Discovery: Dosya bulundu -> ${f.name} (id: ${bId})`);
                
                boards.push({
                    id: bId,
                    name: f.name.replace('.pdf.ncil', '').replace('.ncil', '').replace('.pdf', ''),
                    lastModified: new Date(f.modifiedTime).getTime(),
                    folderId: logicalParentId,
                    googleDriveFileId: f.id,
                    isPDF: isPDFFilename || isPDFNcil || f.appProperties?.type === 'pdf',
                    isRawSource: isRawSource
                });
            }
            
        } catch (e) {
            console.error('[CloudSync] Discovery hatası:', e);
        }

        // Tekilliği sağla (id bazlı) - NCIL dosyalarını ham dosyalara tercih et
        // isRawSource: true olanlar başa, false olanlar sona (sona gelen Map'te kalır)
        boards.sort((a, b) => (a.isRawSource === b.isRawSource) ? 0 : (a.isRawSource ? -1 : 1));
        const uniqueBoards = Array.from(new Map(boards.map(b => [b.id, b])).values());
        const uniqueFolders = Array.from(new Map(folders.map(f => [f.id, f])).values());

        return { version: 2, boards: uniqueBoards, folders: uniqueFolders, syncedAt: new Date().toISOString() };
    }

    async _contentToNcil(c, bId) { 
        if (!window.pako) { 
            await this._loadScript('https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js');
        }
        const comp = window.pako.deflate(JSON.stringify(c));
        const sig = new TextEncoder().encode(APP_CONFIG.SIGNATURE || 'notencil!!');
        const r = new Uint8Array(sig.length + comp.length); 
        r.set(sig); 
        r.set(comp, sig.length); 
        return r;
    }

    // Geriye dönük uyumluluk ve kolay erişim metotları
    async saveToGoogleDrive() { return this.syncWithGoogleDrive(); }
    async loadFromGoogleDrive() { return this.syncWithGoogleDrive(); }

    async deleteFromDrive(ids) {
        await this._ensureToken();
        const list = Array.isArray(ids) ? ids : [ids];
        await this._garbageCollect(null, null, null, list, null);
    }
}

window.CloudStorageManager = CloudStorageManager;
