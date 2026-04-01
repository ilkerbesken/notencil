/**
 * NcilExporter - .ncil formatı için dondurulmuş kaydetme mantığı.
 * BU DOSYA KULLANICI İSTEĞİ ÜZERİNE MUHAFAZA EDİLMEKTEDİR VE DEĞİŞTİRİLMEMELİDİR.
 * (This file is preserved by user request and should not be modified.)
 */
class NcilExporter {
    constructor(app) {
        this.app = app;
        this._pakoReady = false;
    }

    async _ensurePako() {
        if (typeof pako !== 'undefined') { this._pakoReady = true; return; }
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/pako@2.1.0/dist/pako.min.js';
            script.onload = () => { this._pakoReady = true; resolve(); };
            script.onerror = () => { reject(new Error('pako yüklenemedi')); };
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
    }

    async saveAsNcil() {
        await this._waitForPako();
        const dashboard = window.dashboard;
        if (!dashboard) return;

        const boardId = dashboard.currentBoardId;
        const board = dashboard.boards.find(b => b.id === boardId);
        const boardName = board ? board.name : APP_CONFIG.ID;

        const finalData = await this.createNcilDataFromCurrentState();
        const safeName = boardName.replace(/[^a-zA-Z0-9ğüşıöçĞÜŞİÖÇ\s\-_]/g, '').trim() || APP_CONFIG.ID;

        if (window.showSaveFilePicker) {
            try {
                const fileHandle = await window.showSaveFilePicker({
                    suggestedName: `${safeName}${APP_CONFIG.FILE_EXTENSION}`,
                    types: [{ description: `${APP_CONFIG.NAME} Note (${APP_CONFIG.FILE_EXTENSION})`, accept: { [APP_CONFIG.MIME_TYPE]: [APP_CONFIG.FILE_EXTENSION] } }]
                });
                const writable = await fileHandle.createWritable();
                await writable.write(finalData);
                await writable.close();
                this._showToast(`✅ ${window.i18n.t('file_saved')} (${APP_CONFIG.FILE_EXTENSION})`);
                return;
            } catch (e) {
                if (e.name === 'AbortError') return;
            }
        }

        const blob = new Blob([finalData], { type: APP_CONFIG.MIME_TYPE });
        const link = document.createElement('a');
        link.download = `${safeName}${APP_CONFIG.FILE_EXTENSION}`;
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
        this._showToast(`✅ ${window.i18n.t('file_downloaded')} (${APP_CONFIG.FILE_EXTENSION})`);
    }

    async createNcilDataFromCurrentState() {
        await this._waitForPako();
        if (this.app.pageManager) this.app.pageManager.saveCurrentPageState();

        let pages = null;
        if (this.app.pageManager) {
            pages = this.app.pageManager.pages.map(page => {
                const p = Utils.deepClone(page);
                delete p.thumbnail;
                p.objects = p.objects.map(obj => this._serializeObject(obj));
                return p;
            });
        }

        let pdfBase64 = null;
        const boardId = window.dashboard?.currentBoardId;
        if (boardId) {
            try {
                const pdfBlob = await Utils.db.get(boardId);
                if (pdfBlob instanceof Blob) pdfBase64 = await this._blobToBase64(pdfBlob);
            } catch (e) {}
        }

        const content = {
            version: '2.1',
            format: 'ncil',
            savedAt: new Date().toISOString(),
            appVersion: APP_CONFIG.NAME,
            id: boardId,
            pages: pages,
            currentPageIndex: this.app.pageManager ? this.app.pageManager.currentPageIndex : 0,
            pdfBase64: pdfBase64 || undefined
        };

        const jsonStr = JSON.stringify(content);
        const compressed = pako.gzip(jsonStr);
        const header = new TextEncoder().encode(APP_CONFIG.SIGNATURE);
        const finalData = new Uint8Array(header.length + compressed.length);
        finalData.set(header);
        finalData.set(compressed, header.length);
        return finalData;
    }

    _serializeObject(obj) {
        if (!obj) return obj;
        const o = Object.assign({}, obj);
        if (o.type === 'group') {
            o.children = (o.children || []).map(child => this._serializeObject(child));
            return o;
        }
        if ((o.type === 'pen' || o.type === 'highlighter') && Array.isArray(o.points) && !o._flat) {
            const flat = [];
            for (const p of o.points) {
                flat.push(Math.round(p.x * 100000) / 100000);
                flat.push(Math.round(p.y * 100000) / 100000);
                flat.push(p.pressure !== undefined ? (Math.round(p.pressure * 100000) / 100000) : 0.5);
            }
            o.points = flat;
            o._flat = true;
        }
        if (o.type === 'arrow' || o.type === 'line') {
            if (o.start) o.start = this._roundPoint(o.start);
            if (o.end) o.end = this._roundPoint(o.end);
            if (o.curveControlPoint) o.curveControlPoint = this._roundPoint(o.curveControlPoint);
        }
        if (o.x !== undefined) o.x = Math.round(o.x * 100000) / 100000;
        if (o.y !== undefined) o.y = Math.round(o.y * 100000) / 100000;
        if (o.width !== undefined) o.width = Math.round(o.width * 100000) / 100000;
        if (o.height !== undefined) o.height = Math.round(o.height * 100000) / 100000;
        
        // Cleanup runtime props
        delete o._imageCache; delete o._cachedSvg; delete o._cellCaches;
        delete o._cellEditor; delete o._toolbar; delete o._cachedImage;
        return o;
    }

    _roundPoint(p) {
        if (!p) return p;
        return {
            x: Math.round(p.x * 100000) / 100000,
            y: Math.round(p.y * 100000) / 100000,
            pressure: p.pressure !== undefined ? (Math.round(p.pressure * 100000) / 100000) : 0.5
        };
    }

    _blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    _showToast(message) {
        Utils.showToast(message, message.includes('✅') ? 'success' : 'info');
    }
}