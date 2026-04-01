/**
 * PDFManager - Handles PDF background rendering for annotation
 * Senior Developer Approach: Renders PDF pages to offscreen buffers 
 * and integrates with the main notencil render loop.
 */
class PDFManager {
    constructor(app) {
        this.app = app;
        this.pdfDoc = null;
        this.currentUrl = null;
        this.isLoaded = false;
        this.pageBuffers = new Map(); // Stores offscreen canvases for each page
        this.bufferAccessOrder = []; // To implement LRU eviction
        this.maxBuffers = 15; // Keep only 15 high-res pages in memory
        this.loadingBuffers = new Set(); // To prevent redundant concurrent loads

        // PDF.js settings
        if (typeof pdfjsLib !== 'undefined') {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        // Initialize Text Selector
        if (typeof PDFTextSelector !== 'undefined') {
            this.textSelector = new PDFTextSelector(this.app);
        }
    }

    /**
     * Load a PDF from a URL or Blob
     * @param {string|Blob} url 
     */
    async loadPDF(url) {
        try {
            console.log('Loading PDF...');
            this.currentUrl = url;
            const loadingTask = pdfjsLib.getDocument(url);
            this.pdfDoc = await loadingTask.promise;
            
            this.clearBuffers();
            if (this.textSelector) this.textSelector.clear();

            console.log(`PDF loaded: ${this.pdfDoc.numPages} pages`);
            this.isLoaded = true;

            if (this.app.pageManager) {
                const newPages = [];
                const numPages = this.pdfDoc.numPages;

                // Optimization: Fetch page dimensions in parallel batches to avoid main-thread blocking
                const batchSize = 10;
                for (let i = 1; i <= numPages; i += batchSize) {
                    const batchPromises = [];
                    for (let j = i; j < i + batchSize && j <= numPages; j++) {
                        batchPromises.push(this.pdfDoc.getPage(j));
                    }
                    
                    const pages = await Promise.all(batchPromises);
                    pages.forEach((pdfPage, index) => {
                        const pageNum = i + index;
                        const viewport = pdfPage.getViewport({ scale: 1.0 });

                        newPages.push({
                            id: Date.now() + pageNum + Math.random(),
                            name: `Sayfa ${pageNum}`,
                            objects: [],
                            backgroundColor: 'white',
                            backgroundPattern: 'none',
                            thumbnail: null,
                            pdfPageNumber: pageNum,
                            pdfDimensions: {
                                width: viewport.width,
                                height: viewport.height
                            }
                        });
                    });
                    
                    // Allow UI to breathe between batches
                    if (numPages > batchSize) {
                        await new Promise(r => setTimeout(r, 0));
                    }
                }

                // Update the app's page list once fully loaded
                this.app.pageManager.pages = newPages;
                this.app.pageManager.renderPageList();
                
                // Only refresh thumbnails if sidebar is visible to save CPU
                const sidebarVisible = this.app.pageManager.sidebar && !this.app.pageManager.sidebar.classList.contains('collapsed');
                if (sidebarVisible) {
                    this.app.pageManager.refreshAllThumbnails();
                }
            }

            return true;
        } catch (error) {
            console.error('Error loading PDF:', error);
            this.isLoaded = false;
            return false;
        }
    }

    /**
     * Get or render a PDF page buffer
     * @param {number} pageNum 1-indexed
     * @returns {HTMLCanvasElement|null}
     */
    async getPageBuffer(pageNum) {
        if (!this.isLoaded || !this.pdfDoc) return null;

        const pageId = Number(pageNum);
        
        // LRU Cache Check
        if (this.pageBuffers.has(pageId)) {
            // Move to end of access order (most recent)
            this.bufferAccessOrder = this.bufferAccessOrder.filter(id => id !== pageId);
            this.bufferAccessOrder.push(pageId);
            return this.pageBuffers.get(pageId);
        }

        if (this.loadingBuffers.has(pageId)) return null;
        this.loadingBuffers.add(pageId);

        // Render lazily if not in buffer
        try {
            const page = await this.pdfDoc.getPage(pageId);
            const viewport = page.getViewport({ scale: 2.0 }); // 2x for retina/zoom quality

            const buffer = document.createElement('canvas');
            const context = buffer.getContext('2d');
            buffer.width = viewport.width;
            buffer.height = viewport.height;

            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            // Generate Text Layer
            if (this.textSelector) {
                this.textSelector.renderTextLayer(page, viewport);
            }

            // Manage Cache Size (Eviction)
            if (this.pageBuffers.size >= this.maxBuffers) {
                const oldestId = this.bufferAccessOrder.shift();
                const oldestBuffer = this.pageBuffers.get(oldestId);
                if (oldestBuffer) {
                    oldestBuffer.width = 0; // Help GC
                    oldestBuffer.height = 0;
                }
                this.pageBuffers.delete(oldestId);
                
                // Also tell textSelector to evict if possible
                if (this.textSelector && this.textSelector.evictLayer) {
                    this.textSelector.evictLayer(oldestId - 1);
                }
            }

            this.pageBuffers.set(pageId, buffer);
            this.bufferAccessOrder.push(pageId);
            this.loadingBuffers.delete(pageId);
            
            // Trigger a redraw now that we have the background
            this.app.needsRedrawOffscreen = true;
            this.app.needsRender = true;

            // Update thumbnail for this page
            if (this.app.pageManager) {
                this.app.pageManager.updatePageThumbnail(pageId - 1, true);
            }

            return buffer;
        } catch (error) {
            console.error(`Error buffering PDF page ${pageId}:`, error);
            this.loadingBuffers.delete(pageId);
            return null;
        }
    }

    /**
     * Render the PDF background for a specific page onto the given context
     */
    drawToContext(ctx, page, x, y, width, height) {
        if (!this.isLoaded || !this.pdfDoc) return;

        // Ensure page number exists (backward compatibility for old saves)
        const pageNum = Number(page.pdfPageNumber || (this.app.pageManager.pages.indexOf(page) + 1));
        if (!pageNum || isNaN(pageNum)) return;

        const buffer = this.pageBuffers.get(pageNum);
        if (buffer) {
            // Use WebGPU for faster composition if supported and available
            const gpu = window.webGPURenderer;
            if (gpu && gpu.isSupported) {
                const zoom = this.app.zoomManager.zoom;
                const pan = this.app.zoomManager.pan;
                const viewW = this.app.canvas.clientWidth;
                const viewH = this.app.canvas.clientHeight;

                // drawImage(targetCtx, image, x, y, width, height, zoom, viewWidth, viewHeight, pan, opacity)
                const success = gpu.drawImage(ctx, buffer, x, y, width, height, zoom, viewW, viewH, pan);
                if (success) return;
            }

            // Fallback to Canvas2D
            ctx.drawImage(buffer, x, y, width, height);
        } else {
            // Initiate lazy load
            this.getPageBuffer(pageNum);
        }
    }

    /**
     * Clear PDF and return to normal notencil mode
     */
    clearPDF() {
        this.pdfDoc = null;
        this.currentUrl = null;
        this.isLoaded = false;
        this.clearBuffers();
        if (this.textSelector) this.textSelector.clear();
    }

    /**
     * Internal helper to clear memory
     */
    clearBuffers() {
        this.pageBuffers.forEach(canvas => {
            canvas.width = 0;
            canvas.height = 0;
        });
        this.pageBuffers.clear();
        this.bufferAccessOrder = [];
        this.loadingBuffers.clear();
    }
}
