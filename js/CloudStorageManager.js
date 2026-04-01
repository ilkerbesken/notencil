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
        // AppData kapsamı geçici olarak kaldırıldı (Hata analizi için)
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
        this._driveFolderCache = new Map(); // Klasör ID eşleşmelerini önbelleğe al
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
        console.log('[CloudSync] Google Girişi başlatılıyor...');
        await this.init();
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Google Girişi zaman aşımına uğradı. Lütfen popup pencerelerini kontrol edin.'));
            }, 60000); // 1 dakika

            try {
                // eslint-disable-next-line no-undef
                const client = google.accounts.oauth2.initTokenClient({
                    client_id: this.GOOGLE_CLIENT_ID,
                    scope: this.GOOGLE_SCOPES,
                    callback: (r) => {
                        clearTimeout(timeout);
                        if (r.error) {
                            console.error('[CloudSync] Google Giriş Hatası:', r.error);
                            return reject(new Error(r.error));
                        }
                        console.log('[CloudSync] Google Girişi başarılı.');
                        this.gdriveToken = r.access_token;
                        localStorage.setItem(`${APP_CONFIG.STORAGE_PREFIX}gdrive_token`, r.access_token);
                        resolve(r.access_token);
                    },
                });
                client.requestAccessToken();
            } catch (err) {
                clearTimeout(timeout);
                console.error('[CloudSync] Client başlatma hatası:', err);
                reject(err);
            }
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
        console.log('[CloudSync] Senkronizasyon başlatılıyor...', { targetId });
        if (this.isSyncing && !targetId) return { success: false, message: 'Senkronizasyon zaten sürüyor.' };
        if (targetId && this._activeSyncs?.has(targetId)) return { success: false, message: 'Öğe zaten senkronize ediliyor.' };
        
        if (targetId) this._activeSyncs.add(targetId); else this.isSyncing = true;
        this._driveFolderCache.clear();

        try {
            await this._ensureToken();
            console.log('[CloudSync] Token doğrulandı.');
            const fsm = window.fileSystemManager;

            // 1. ADIM: Temel Klasörleri Bul (Hızlı)
            console.log('[CloudSync] Adım 1: Klasörler kontrol ediliyor...');
            
            // AppDataFolder geçici olarak devre dışı (Hata analizi için)
            let appFolderId = await this._getOrCreateDriveFolderMinimal(APP_CONFIG.GDRIVE_FOLDER, null);
            console.log('[CloudSync] Root Klasör ID:', appFolderId);
            
            if (!appFolderId) throw new Error('Root klasör oluşturulamadı veya bulunamadı.');

            const settingsFolderId = await this._getOrCreateDriveFolderMinimal('.settings', appFolderId);
            console.log('[CloudSync] Settings Klasör ID:', settingsFolderId);

            let syncCount = 0;

            // 2. ADIM: Downstream (Drive -> Local)
            console.log('[CloudSync] Adım 2: Manifest çekiliyor...');
            let remoteManifest = await this._pullManifest(settingsFolderId);
            let isDiscoveryMode = false;

            // Eğer manifest yoksa ama yerel boşsa, Drive'ı "Keşfet"
            if (!remoteManifest && targetId === null) {
                const localBoards = await fsm.getItem('wb_boards', []);
                if (localBoards.length === 0) {
                    console.log('[CloudSync] Manifest bulunamadı, derin keşif başlatılıyor...');
                    remoteManifest = await this._reconstructManifestByDiscovery(appFolderId);
                    isDiscoveryMode = true;
                }
            }

            if (remoteManifest) {
                console.log('[CloudSync] Uzak değişiklikler birleştiriliyor...');
                syncCount += await this._mergeRemoteChanges(remoteManifest, appFolderId, isDiscoveryMode);
            }

            // 3. ADIM: Upstream (Local -> Drive)
            if (!isDiscoveryMode) {
                console.log('[CloudSync] Adım 3: Yerel değişiklikler yükleniyor...');
                syncCount += await this._pushLocalChanges(appFolderId);
            }

            // 4. ADIM: Manifest Update
            if (syncCount > 0) {
                console.log('[CloudSync] Adım 4: Manifest güncelleniyor...');
                await this._syncManifest(settingsFolderId);
            }

            console.log('[CloudSync] Senkronizasyon başarıyla tamamlandı. İşlem sayısı:', syncCount);
            return { success: true, message: syncCount > 0 ? `${syncCount} değişiklik işlendi.` : 'Her şey güncel.', syncCount };

        } catch (err) {
            console.error('[CloudSync] Kritik Hata:', err);
            return { success: false, message: 'Senkronizasyon hatası: ' + err.message };
        } finally {
            if (targetId) this._activeSyncs.delete(targetId); else this.isSyncing = false;
        }
    }

    async _pullManifest(settingsFolderId) {
        try {
            const q = `name='${APP_CONFIG.MANIFEST_FILE}' and '${settingsFolderId}' in parents and trashed=false`;
            // Cache-busting parameter t=Date.now() to ensure we get the latest manifest from Drive
            const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', t: Date.now() });
            const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            const data = await res.json();
            const file = data.files?.[0];
            if (!file) return null;

            // Media fetch also with cache-busting
            const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&t=${Date.now()}`, {
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
            else {
                // Yerelde board var, içeriği kontrol et
                const localContent = await fsm.getItem(`wb_content_${rb.id}`, null);
                if (!localContent && !rb.isRawSource) {
                    // İçerik yok ama Drive'da NCIL var -> Mutlaka indir (Broken state recovery)
                    console.log(`[CloudSync] Yerel içerik eksik, indirme tetiklendi: ${rb.name}`);
                    needsPull = true;
                } else if (rb.lastModified > (lb.lastModified || 0)) {
                    needsPull = true;
                }
            }

            // LINKING: Eğer yerelde board varsa ama Drive ID'si eşleşmemişse, eşleştir
            if (lb && !meta?.googleDriveFileId && rb.googleDriveFileId) {
                console.log(`[CloudSync] Mevcut yerel not Drive dosyasıyla eşleştirildi: ${lb.name}`);
                const now = Date.now();
                await fsm.setSyncMetadata(rb.id, { 
                    googleDriveFileId: rb.googleDriveFileId, 
                    lastSyncedTime: Math.max(now, lb.lastModified || 0) 
                });
            }

            if (needsPull) {
                const content = await this._downloadBoardById(rb.id, rb.googleDriveFileId || meta?.googleDriveFileId);
                if (content) {
                    if (content._isRawPDF) {
                        // Eğer indirilen dosya ham bir PDF ise, yereldeki çizimleri ezmemek için kontrol et
                        const localContent = await fsm.getItem(`wb_content_${rb.id}`, null);
                        if (!localContent || !localContent.pages || localContent.pages.length === 0) {
                            // Sadece yerel içerik yoksa veya boşsa minimal içerik oluştur
                            await Utils.db.save(rb.id, content.blob);
                            const minimal = { version: "2.1", pages: [], pdfBase64: null, objects: [] };
                            await fsm.saveItem(`wb_content_${rb.id}`, minimal, true, true);
                            rb.isPDF = true;
                            rb.alwaysSaveAsPDF = true;
                        } else {
                            console.log(`[CloudSync] Ham PDF indirildi ancak yerel çizimler korunuyor: ${rb.name}`);
                            await Utils.db.save(rb.id, content.blob); // PDF arka planını güncelle ama çizimleri elleme
                        }
                    } else {
                        await fsm.saveItem(`wb_content_${rb.id}`, content, true, true);
                        
                        // Eğer bu bir PDF board ise, Drive'dan PDF'i de çek (Çevrimdışı erişim için)
                        if (rb.isPDF) {
                            console.log(`[CloudSync] PDF arka planı kontrol ediliyor: ${rb.name}`);
                            await this._downloadPdfBackground(rb);
                        }

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
                    
                    // ÖNEMLİ: İndirme sonrası SyncMetadata'yı güncelle
                    // Hem googleDriveFileId'yi mühürle hem de lastSyncedTime'ı güncelle ki
                    // az önce indirdiğimiz dosyayı hemen geri yüklemeye çalışmayalım.
                    const syncId = rb.isRawSource ? null : (rb.googleDriveFileId || meta?.googleDriveFileId);
                    const now = Date.now();
                    await fsm.setSyncMetadata(rb.id, { 
                        googleDriveFileId: syncId, 
                        lastSyncedTime: Math.max(now, rb.lastModified || 0),
                        lastModifiedLocally: rb.lastModified || now
                    });
                    
                    count++;
                }
            } else if (rb.isPDF) {
                // Board güncel olsa bile, yerelde PDF eksikse indir (Çevrimdışı erişim garantisi)
                const localPdf = await Utils.db.get(rb.id);
                if (!localPdf) {
                    console.log(`[CloudSync] Board güncel ama PDF eksik, indiriliyor: ${rb.name}`);
                    await this._downloadPdfBackground(rb);
                    count++; // PDF indiği için bir değişiklik sayılabilir
                }
            }
            
            // Link existing boards that don't have Drive ID yet
            if (lb && !meta?.googleDriveFileId && rb.googleDriveFileId && !rb.isRawSource) {
                console.log(`[CloudSync] Mevcut yerel not Drive dosyasıyla eşleştirildi: ${lb.name}`);
                lb.googleDriveFileId = rb.googleDriveFileId;
                const now = Date.now();
                await fsm.setSyncMetadata(rb.id, { 
                    googleDriveFileId: rb.googleDriveFileId, 
                    lastSyncedTime: Math.max(now, lb.lastModified || 0),
                    lastModifiedLocally: lb.lastModified
                });
                count++;
            }
        }

        if (count > 0) {
            await fsm.saveItem('wb_boards', localBoards, true, true);
            await fsm.saveItem('wb_folders', localFolders, true, true);
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
        console.log(`[CloudSync] ${boards.length} not kontrol ediliyor...`);
        for (const board of boards) {
            let meta = await fsm.getSyncMetadata(board.id);
            
            // Eğer meta yoksa (yeni yerel import), varsayılan bir meta oluştur ve push et
            if (!meta) {
                meta = { 
                    id: board.id, 
                    googleDriveFileId: null, 
                    lastSyncedTime: 0, 
                    lastModifiedLocally: board.lastModified || Date.now() 
                };
                await fsm.setSyncMetadata(board.id, meta);
            }

            // PDF boards: Always ensure PDF background is on Drive, even if metadata seems synced
            // because the background PDF might have been missed in previous versions.
            // OR if it's explicitly a PDF but has no Drive ID for the PDF part.
            const needsPush = !meta.googleDriveFileId || (board.lastModified > (meta.lastSyncedTime || 0) + 2000);
            
            if (board.isPDF || needsPush) {
                console.log(`[CloudSync] İşleniyor: ${board.name}...`);
                let content = await fsm.getItem(`wb_content_${board.id}`, null);
                
                // FIX: Skeleton gönderme, sadece PDF arka planını yükle
                let pdfOnlyUpload = false;
                if (!content) {
                    if (board.isPDF) {
                        // Sadece ham PDF'i yükle, boş .ncil gönderme
                        console.log(`[CloudSync] İçerik henüz yok, sadece PDF arka planı kontrol ediliyor: ${board.name}`);
                        pdfOnlyUpload = true;
                    } else {
                        console.log(`[CloudSync] İçerik henüz yok, atlanıyor: ${board.name}`);
                        continue;
                    }
                }

                if (content || pdfOnlyUpload) {
                    const targetParentId = board.folderId ? driveFolderMapping[board.folderId] : appFolderId;
                    try {
                        let driveFileId;

                        // PDF ise her zaman ham PDF'i de Drive'a gönder (Arka plan olarak kullanılacak)
                        if (board.isPDF) {
                            let pdfBlob = await Utils.db.get(board.id);
                            
                            // Eğer DB'de yoksa ama native moddaysak yerel klasörden oku
                            if (!pdfBlob && this.fsm.mode === 'native') {
                                pdfBlob = await this.fsm._loadPDFFromNative(board.id);
                            }

                            if (pdfBlob && pdfBlob instanceof Blob) {
                                // Drive'da .pdf dosyasını ara
                                // FIX: Artık expectRaw=true parametresiyle arıyoruz
                                const existingPdfId = await this._findFileByBoardId(board.id, targetParentId, true);

                                // ZAMAN KONTROLÜ: Eğer Drive'da yoksa veya yereldeki daha yeniyse yükle
                                let shouldUploadPdf = true;
                                if (existingPdfId) {
                                    // ModifiedTime kontrolü için dosyayı çek
                                    const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${existingPdfId}?fields=modifiedTime`, {
                                        headers: { Authorization: `Bearer ${this.gdriveToken}` }
                                    });
                                    const drivePdfFile = await metaRes.json();
                                    const driveTime = new Date(drivePdfFile.modifiedTime).getTime();
                                    const localTime = board.lastModified || meta.lastModifiedLocally || 0;
                                    // Sadece Drive'daki kesinlikle daha yeniyse atla
                                    if (driveTime > localTime + 1000) { 
                                        shouldUploadPdf = false;
                                        console.log(`[CloudSync] PDF Arka Planı güncel, atlanıyor: ${board.name}.pdf`);
                                    }
                                }

                                if (shouldUploadPdf) {
                                    const bytes = new Uint8Array(await pdfBlob.arrayBuffer());
                                    await this._uploadRawToDrive(`${board.name}.pdf`, bytes, 'application/pdf', targetParentId, existingPdfId, { boardId: board.id, type: 'pdf', isRaw: 'true' });
                                    console.log(`[CloudSync] PDF Arka Planı yüklendi/güncellendi: ${board.name}.pdf`);
                                }
                            }
                        }

                        if (board.isRawSource && board.isPDF && !needsPush) {
                            // Eğer sadece ham PDF ise ve içerik değişikliği yoksa, mevcut ID'yi koru
                            // ÖNEMLİ: Eğer meta'da bir NCIL ID'si varsa onu tercih etmeliyiz
                            driveFileId = meta.googleDriveFileId;
                            
                            // Eğer meta ID'si bir PDF'e işaret ediyorsa, Drive'da bir NCIL var mı diye tekrar kontrol et
                            const isActualNcil = driveFileId ? await this._checkIfFileIsNcil(driveFileId) : false;
                            if (!isActualNcil) {
                                // FIX: expectRaw=false (varsayılan) ile NCIL ara
                                const foundNcilId = await this._findFileByBoardId(board.id, targetParentId);
                                if (foundNcilId) driveFileId = foundNcilId;
                            }
                        } else if (content) {
                            // Normal board veya üzerine not alınmış PDF (.ncil sidecar)
                            let targetIdForUpload = meta.googleDriveFileId;
                            
                            // Eğer Drive ID'si yoksa veya bir PDF'e işaret ediyorsa, gerçek NCIL'i bulmaya çalış
                            const isKnownNcil = targetIdForUpload ? await this._checkIfFileIsNcil(targetIdForUpload) : false;
                            if (!isKnownNcil) {
                                // FIX: expectRaw=false (varsayılan) ile NCIL ara
                                targetIdForUpload = await this._findFileByBoardId(board.id, targetParentId);
                            }

                            driveFileId = await this._uploadBoardNcil(board, content, folders, appFolderId, targetIdForUpload, targetParentId);
                        } else if (board.isPDF) {
                            // PDF board ama henüz içerik yok, NCIL yüklemeye gerek yok
                            // PDF arka planı yukarıdaki blokta zaten yüklendi/güncellendi.
                            driveFileId = meta.googleDriveFileId || await this._findFileByBoardId(board.id, targetParentId, true);
                        }

                        if (driveFileId) {
                            const now = Date.now();
                            // Son senkronizasyon zamanını hem yerel hem de Drive saatinin üzerine çıkarıyoruz
                            await fsm.setSyncMetadata(board.id, { 
                                googleDriveFileId: driveFileId, 
                                lastSyncedTime: Math.max(now, board.lastModified || 0)
                            });
                            
                            // Board objesine de Drive ID'sini ekle (Manifeste dahil olması için)
                            board.googleDriveFileId = driveFileId;
                            
                            count++;
                            console.log(`[CloudSync] Başarıyla yüklendi: ${board.name} (Drive ID: ${driveFileId})`);
                        }
                    } catch (err) {
                        console.error(`[CloudSync] ${board.name} yükleme hatası:`, err);
                    }
                }
            }
        }

        if (count > 0) {
             // Değişiklikleri yerel listeye kaydet (googleDriveFileId vb.)
             await fsm.saveItem('wb_boards', boards, true, true);
         }

        console.log(`[CloudSync] Toplam ${count} not Drive'a yüklendi.`);
        return count;
    }

    async _downloadBoardById(boardId, driveId) {
        if (!driveId) {
            // ÖNCE .ncil veya çizim içeren dosyayı ara (isRaw olmayan)
            const q = `appProperties has { key='boardId' and value='${boardId}' } and trashed=false`;
            const params = new URLSearchParams({ q, fields: 'files(id, name, appProperties)', pageSize: '10' });
            const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            const data = await res.json();
            
            if (data.files && data.files.length > 0) {
                // isRaw=true olmayan (yani çizim dosyası olan) ilk dosyayı seç
                const ncilFile = data.files.find(f => f.appProperties?.isRaw !== 'true');
                driveId = ncilFile ? ncilFile.id : data.files[0].id;
            }
        }

        if (!driveId) return null;

        try {
            // Media fetch with cache-busting
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?alt=media&t=${Date.now()}`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            
            if (!res.ok) {
                console.error('[CloudSync] Dosya içeriği indirilemedi:', driveId, res.status);
                return null;
            }

            const arrayBuffer = await res.arrayBuffer();
            return await this._inflateNcilData(arrayBuffer);
        } catch (e) {
            console.error('[CloudSync] İndirme hatası:', boardId, e);
            return null;
        }
    }

    async _downloadPdfBackground(board) {
        try {
            await this._ensureToken();
            let driveId = null;

            // 1. ADIM: boardId'ye göre Drive'daki ham PDF'i ara
            const q = `appProperties has { key='boardId' and value='${board.id}' } and appProperties has { key='isRaw' and value='true' } and trashed=false`;
            const params = new URLSearchParams({ q, fields: 'files(id, name)', pageSize: '1' });
            const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            const data = await res.json();
            
            if (data.files?.[0]) {
                driveId = data.files[0].id;
            }

            // 2. ADIM: Bulunamazsa isimle ara (Eski sürümler veya manuel yükleme için)
            if (!driveId) {
                // PDF uzantısı olduğundan emin ol
                const searchName = board.name.toLowerCase().endsWith('.pdf') ? board.name : `${board.name}.pdf`;
                const qName = `name='${searchName}' and trashed=false`;
                const paramsName = new URLSearchParams({ q: qName, fields: 'files(id)', pageSize: '1' });
                const resName = await fetch(`https://www.googleapis.com/drive/v3/files?${paramsName}`, {
                    headers: { Authorization: `Bearer ${this.gdriveToken}` }
                });
                const dataName = await resName.json();
                if (dataName.files?.[0]) {
                    driveId = dataName.files[0].id;
                }
            }

            if (driveId) {
                console.log(`[CloudSync] PDF indiriliyor (Drive ID: ${driveId})...`);
                const pdfRes = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}?alt=media`, {
                    headers: { Authorization: `Bearer ${this.gdriveToken}` }
                });
                if (pdfRes.ok) {
                    const blob = await pdfRes.blob();
                    await Utils.db.save(board.id, blob);
                    console.log(`[CloudSync] PDF arka planı başarıyla Drive'dan indirildi: ${board.name}`);
                    return true;
                }
            } else {
                console.warn(`[CloudSync] Drive'da PDF arka planı bulunamadı: ${board.name}`);
            }
        } catch (e) {
            console.error('[CloudSync] PDF arka planı indirme hatası:', e);
        }
        return false;
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

    // ─── Cihazlar Arası Yapılandırma (AppDataFolder) ──────────────────
    
    async _getAppFolderIdFromConfig() {
        if (this._appDataDisabled) return null;
        try {
            // AppDataFolder içindeki yapılandırma dosyasını ara
            const q = "name='notencil-config.json' and 'appDataFolder' in parents and trashed=false";
            const params = new URLSearchParams({ q, spaces: 'appDataFolder', fields: 'files(id)', t: Date.now() });
            const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            
            if (res.status === 403) {
                console.warn('[CloudSync] AppDataFolder erişim izni yok, bu özellik devre dışı bırakıldı.');
                this._appDataDisabled = true;
                return null;
            }

            const data = await res.json();
            const file = data.files?.[0];
            if (!file) return null;

            // İçeriği oku
            const contentRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&t=${Date.now()}`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            if (!contentRes.ok) return null;
            const config = await contentRes.json();
            return config.rootFolderId;
        } catch (e) {
            console.warn('[CloudSync] Config okunamadı:', e);
            return null;
        }
    }

    async _saveAppFolderIdToConfig(rootFolderId) {
        if (this._appDataDisabled) return;
        try {
            const config = { rootFolderId, lastUpdated: new Date().toISOString() };
            const bytes = new TextEncoder().encode(JSON.stringify(config, null, 2));
            
            // AppDataFolder içinde dosya var mı?
            const q = "name='notencil-config.json' and 'appDataFolder' in parents and trashed=false";
            const params = new URLSearchParams({ q, spaces: 'appDataFolder', fields: 'files(id)' });
            const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            
            if (res.status === 403) {
                this._appDataDisabled = true;
                return;
            }

            const data = await res.json();
            const existingId = data.files?.[0]?.id;

            // appDataFolder için parents dizisi 'appDataFolder' olmalı
            const metadata = existingId ? { name: 'notencil-config.json' } : { name: 'notencil-config.json', parents: ['appDataFolder'] };
            
            await this._uploadRawToDrive('notencil-config.json', bytes, 'application/json', 'appDataFolder', existingId);
            console.log('[CloudSync] Root ID yapılandırması Drive AppDataFolder\'a kaydedildi.');
        } catch (e) {
            console.warn('[CloudSync] Config kaydedilemedi:', e);
        }
    }

    // ─── Klasör Yönetimi (Yeni Robust Mantık) ──────────────────────
    
    async _getDriveTargetFolderRobust(folderId, folders, appFolderId) {
        const path = []; let curr = folderId;
        const visited = new Set();
        while (curr) { 
            if (visited.has(curr)) break; // Sonsuz döngü koruması
            visited.add(curr);
            const f = folders.find(x => x.id === curr); 
            if (!f) break; 
            path.unshift(f); 
            curr = f.parentId; 
        }
        
        let lastId = appFolderId;
        for (const f of path) {
            lastId = await this._getOrCreateDriveFolderMinimal(f.name, lastId);
        }
        return lastId;
    }

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

    async _findFileByBoardId(boardId, parentId = null, expectRaw = false) {
        try {
            let q = `appProperties has { key='boardId' and value='${boardId}' } and trashed=false`;
            if (parentId) q += ` and '${parentId}' in parents`;
            
            // Raw PDF mi yoksa NCIL mi arıyoruz?
            if (expectRaw) {
                q += ` and appProperties has { key='isRaw' and value='true' }`;
            } else {
                // NCIL ararken isRaw=true olanları ele
                q += ` and not appProperties has { key='isRaw' and value='true' }`;
            }

            const params = new URLSearchParams({ q, fields: 'files(id)', pageSize: '1' });
            const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            const data = await res.json();
            return data.files?.[0]?.id || null;
        } catch (e) {
            console.warn('[CloudSync] Board ID ile dosya arama hatası:', e);
            return null;
        }
    }

    async _findOrCreateFolderInList(name, parentId, folderId) {
        if (this._driveFolderCache.has(folderId)) return this._driveFolderCache.get(folderId);

        // 1. Önce appProperties içindeki folderId (yerel unique ID) ile ara
        const qId = `appProperties has { key='folderId' and value='${folderId}' } and trashed=false`;
        const paramsId = new URLSearchParams({ q: qId, fields: 'files(id, name, parents)', pageSize: '1' });
        const resId = await fetch(`https://www.googleapis.com/drive/v3/files?${paramsId}`, {
            headers: { Authorization: `Bearer ${this.gdriveToken}` }
        });
        const dataId = await resId.json();
        
        if (dataId.files?.[0]) {
            const f = dataId.files[0];
            // Eğer ebeveyn değişmişse (opsiyonel ama tutarlılık için iyi)
            // if (!f.parents?.includes(parentId)) { ... move logic ... }
            this._driveFolderCache.set(folderId, f.id);
            return f.id;
        }

        // 2. Bulunamazsa name ve parentId ile ara (Eski sürümler veya manuel oluşturulanlar için)
        const qName = `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const paramsName = new URLSearchParams({ q: qName, fields: 'files(id)', pageSize: '1' });
        const resName = await fetch(`https://www.googleapis.com/drive/v3/files?${paramsName}`, {
            headers: { Authorization: `Bearer ${this.gdriveToken}` }
        });
        const dataName = await resName.json();
        
        if (dataName.files?.[0]) {
            this._driveFolderCache.set(folderId, dataName.files[0].id);
            return dataName.files[0].id;
        }

        // 3. Hiç bulunamazsa oluştur
        const body = { 
            name, 
            mimeType: 'application/vnd.google-apps.folder', 
            parents: [parentId], 
            appProperties: { folderId, type: 'folder' } 
        };
        const cRes = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.gdriveToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const f = await cRes.json();
        this._driveFolderCache.set(folderId, f.id);
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

    async _checkIfFileIsNcil(fileId) {
        try {
            const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,appProperties`, {
                headers: { Authorization: `Bearer ${this.gdriveToken}` }
            });
            const data = await res.json();
            
            // 1. İsim .ncil ile mi bitiyor?
            const isNcilName = data.name?.toLowerCase().endsWith('.ncil');
            
            // 2. Metadata'da 'isRaw' özelliği var mı? 
            // Eğer 'isRaw' true ise bu ham bir PDF'dir, sidecar (.ncil) DEĞİLDİR.
            const isRaw = data.appProperties?.isRaw === 'true';
            
            // 3. Bizim board tipimiz mi?
            const isBoardType = data.appProperties?.type === 'board' || data.appProperties?.type === 'pdf';

            return (isNcilName || isBoardType) && !isRaw;
        } catch (e) {
            return false;
        }
    }

    async _uploadRawToDrive(name, bytes, mime, folderId, existingId, appProps = {}) {
        // Multipart upload yerine Resumable Upload kullanıyoruz (Büyük dosyalar için)
        const metadata = existingId ? { name, appProperties: appProps } : { name, parents: [folderId], appProperties: appProps };
        
        try {
            console.log(`[CloudSync] Yükleme başlatılıyor: ${name}`, { existingId });
            
            // 1. ADIM: Upload session başlat
            const sessionUrl = existingId 
                ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=resumable` 
                : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
            
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 saniye timeout

            const sessionRes = await fetch(sessionUrl, {
                method: existingId ? 'PATCH' : 'POST',
                headers: {
                    'Authorization': `Bearer ${this.gdriveToken}`,
                    'Content-Type': 'application/json',
                    'X-Upload-Content-Type': mime,
                    'X-Upload-Content-Length': bytes.length
                },
                body: JSON.stringify(metadata),
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (!sessionRes.ok) {
                const errData = await sessionRes.json();
                console.error('[CloudSync] Session başlatma hatası:', name, errData);
                throw new Error(`Drive session hatası (${sessionRes.status}): ${errData.error?.message || 'Bilinmeyen hata'}`);
            }

            const uploadUrl = sessionRes.headers.get('Location');
            console.log(`[CloudSync] Session alındı, veri gönderiliyor: ${name}`);

            // 2. ADIM: Binary veriyi gönder
            const binaryController = new AbortController();
            const binaryTimeoutId = setTimeout(() => binaryController.abort(), 60000); // 60 saniye timeout

            const blob = new Blob([bytes], { type: mime });
            const uploadRes = await fetch(uploadUrl, {
                method: 'PUT',
                body: blob,
                signal: binaryController.signal
            });
            clearTimeout(binaryTimeoutId);

            if (!uploadRes.ok) {
                const errData = await uploadRes.json();
                console.error('[CloudSync] Binary transfer hatası:', name, errData);
                throw new Error(`Drive binary hatası (${uploadRes.status}): ${errData.error?.message || 'Bilinmeyen hata'}`);
            }

            const r = await uploadRes.json(); 
            console.log(`[CloudSync] Yükleme tamamlandı: ${name}, ID: ${r.id}`);
            return r.id;

        } catch (err) {
            if (err.name === 'AbortError') {
                throw new Error(`Yükleme zaman aşımına uğradı: ${name}`);
            }
            console.error('[CloudSync] Resumable upload başarısız:', err);
            throw err;
        }
    }

    async _uploadBoardNcil(board, content, folders, appFolderId, existingId, targetParentId = null) {
        const targetId = targetParentId || (board.folderId ? await this._getDriveTargetFolderRobust(board.folderId, folders, appFolderId) : appFolderId);
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
                
                // CANONICAL ID: Her cihazda tutarlılık için mutlaka appProperties.boardId kullanılmalı.
                const boardId = f.appProperties?.boardId;
                
                if (!boardId) {
                    console.warn(`[CloudSync] boardId eksik, atlanıyor: ${f.name} (Drive ID: ${f.id})`);
                    continue;
                }

                // Dashboard.js "b_" ön eki beklediği için eğer yoksa ekliyoruz (Normalde b_ ile başlamalı)
                let bId = boardId;
                if (!bId.startsWith('b_')) bId = 'b_' + bId;
                
                // Ham kaynak tespiti:
                // 1. appProperties.isRaw === 'true' (Yeni versiyon)
                const isRawSource = f.appProperties?.isRaw === 'true';

                console.log(`[CloudSync] Discovery: Dosya bulundu -> ${f.name} (boardId: ${bId})`);
                
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
        
        // Unified format: gzip + signature (matches NcilFileManager and FileSystemManager)
        // Serialize content before zipping (rounding coordinates, pressure, opacity, etc.)
        const serialized = this.app.ncilFileManager ? await this.app.ncilFileManager.serializeContent(c, bId) : c;
        
        const jsonStr = JSON.stringify(serialized);
        const compressed = window.pako.gzip(jsonStr);
        const sig = new TextEncoder().encode(APP_CONFIG.SIGNATURE || 'NOTENCIL!');
        const r = new Uint8Array(sig.length + compressed.length); 
        r.set(sig); 
        r.set(compressed, sig.length); 
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
