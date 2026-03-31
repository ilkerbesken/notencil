class Dashboard {
    constructor(app) {
        this.app = app;
        app.dashboard = this;
        this.container = document.getElementById('dashboard');
        this.appContainer = document.getElementById('app');
        this.boardGrid = document.getElementById('boardGrid');
        this.btnNewBoard = document.getElementById('btnSidebarNewBoard');
        this.btnNewFolder = document.getElementById('btnNewFolder');
        this.breadcrumb = document.querySelector('.breadcrumb');
        this.breadcrumbPathRow = document.getElementById('breadcrumbPathRow');
        this.breadcrumbPathText = document.getElementById('breadcrumbPathText');
        this.folderList = document.getElementById('folderList');
        this.searchInput = document.getElementById('searchInput');
        this.mobileSearchInput = document.getElementById('mobileSearchInput');
        this.searchClearBtn = document.getElementById('searchClear');
        this.mobileSearchClearBtn = document.getElementById('mobileSearchClear');
        this.btnEmptyTrash = document.getElementById('btnEmptyTrash');
        this.btnSelectAll = document.getElementById('btnSelectAll');
        this.btnSelectAllMobile = document.getElementById('btnSelectAllMobile');
        this.btnSortFolders = document.getElementById('btnSortFolders');
        this.btnSortFoldersHeader = document.getElementById('btnSortFoldersHeader');
        this.sortFoldersDropdown = document.getElementById('sortFoldersDropdown');
        this.btnSortNotes = document.getElementById('btnSortNotes');
        this.sortOptionsDropdown = document.getElementById('sortOptionsDropdown');
        this.loader = document.getElementById('dashboardLoader');
        this.todayNotesBadge = document.getElementById('todayNotesBadge');
        this.todayNotesPopup = document.getElementById('todayNotesPopup');




        this.currentBoardId = null;
        this.currentView = 'all';
        this.searchTerm = '';
        this.selectedBoards = new Set();
        this.bulkMode = false;
        this.currentView = 'all';
        this.searchTerm = '';


        this.boards = [];
        this.folders = [];
        this.viewSettings = { gridSize: 'xsmall' };
        this.sidebarCollapsed = false;
        this.expandedFolders = [];
        this.customCovers = [];

        this.defaultCovers = [
            { id: 'c1', bg: '#ff5c5c', texture: 'none' },
            { id: 'c2', bg: '#ffb85c', texture: 'none' },
            { id: 'c3', bg: '#ffd900', texture: 'none' },
            { id: 'c4', bg: '#fab005', texture: 'none' },
            { id: 'c5', bg: '#5cbd62', texture: 'none' },
            { id: 'c6', bg: '#5c9bfe', texture: 'none' },
            { id: 'c7', bg: '#b45cff', texture: 'none' },
            { id: 'c8', bg: '#313131', texture: 'none' }
        ];
        this.customCovers = []; // Will load in initAsync
        this._pdfBase64Cache = new Map(); // Cache for PDF base64 strings to speed up saving
        this._pdfInDbCache = new Set();   // Cache for board IDs whose PDF blob exists in IndexedDB
        this._lastOpenedBoardId = null;   // Tracks the board ID across navigation for background save

        this.folderIcons = [
            'folder', 'star-01', 'book-open-01', 'file-02', 'search-refraction', 'mail-01', 
            'briefcase-01', 'calendar', 'camera-01', 'image-01', 'map-01', 'globe-01', 
            'music-note-01', 'heart', 'phone', 'settings-02'
        ];

        this.initialized = false;
        this.initAsync();
        this.setupAutosaveFlush();
    }

    async initAsync() {
        // Initialize FileSystemManager first
        await window.fileSystemManager.init();

        // Now load data using the new async manager
        this.boards = await this.loadDataAsync('wb_boards', []);
        this.folders = await this.loadDataAsync('wb_folders', []);
        this.viewSettings = await this.loadDataAsync('wb_view_settings', { gridSize: 'xsmall', rememberLastPage: true, autosaveInterval: 'off', darkTheme: false });
        this.sidebarCollapsed = await this.loadDataAsync('wb_sidebar_collapsed', false);
        this.expandedFolders = await this.loadDataAsync('wb_expanded_folders', []);
        this.folderSortOrder = await this.loadDataAsync('wb_folder_sort_order', 'none'); // 'none', 'asc', 'desc'
        this.boardSortField = await this.loadDataAsync('wb_board_sort_field', 'date'); // 'name', 'date', 'size'
        this.boardSortOrder = await this.loadDataAsync('wb_board_sort_order', 'desc'); // 'asc', 'desc'
        this.customCovers = await this.loadDataAsync('wb_custom_covers', []);

        this.applyTheme();
        this.init();
        this.setupSettingsModal();

        // ─── Cloud Sync Logic ─────────────────────────────────────
        if (localStorage.getItem(`${APP_CONFIG.STORAGE_PREFIX}gdrive_token`)) {
            setTimeout(async () => {
                const cloud = new CloudStorageManager(this.app);

                // If local storage is empty, attempt a full restore from Drive
                if (this.boards.length === 0) {
                    console.log('[Dashboard] Local storage empty, attempting to restore from Google Drive...');
                    const res = await cloud.loadFromGoogleDrive();
                    if (res && res.success && (res.syncCount > 0 || res.delta)) {
                        // Refresh UI with new data only if something actually changed
                        console.log(`[Dashboard] Sync successful, ${res.syncCount} items downloaded. Reloading UI...`);
                        await this.initAsync();
                        return;
                    } else if (res && res.success) {
                        console.log('[Dashboard] Restore completed but no new files were found.');
                    }
                }

                // Normal background sync
                cloud.syncWithGoogleDrive().catch(() => { });
            }, 1500);

            this.setupAutoSync();
        }
        this.initialized = true;
    }

    // Sync wrappers for legacy components
    loadData(key, defaultValue) {
        const local = localStorage.getItem(key);
        return local ? JSON.parse(local) : defaultValue;
    }

    saveData(key, value) {
        this.saveDataAsync(key, value);
    }

    getCloudSync() {
        if (!this._cloudStorage && window.CloudStorageManager) {
            this._cloudStorage = new window.CloudStorageManager(this.app);
        }
        return this._cloudStorage;
    }

    async _syncDeletionToDrive(ids) {
        if (!ids || ids.length === 0) return;
        const list = Array.isArray(ids) ? ids : [ids];
        if (localStorage.getItem(`${APP_CONFIG.STORAGE_PREFIX}gdrive_token`)) {
            const cloud = this.getCloudSync();
            if (cloud) {
                await cloud.deleteFromDrive(list);
            }
        }
    }


    applyTheme() {
        const isDark = this.viewSettings.darkTheme === true;
        document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
        
        // Update meta theme-color for PWA and browser UI
        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) {
            metaTheme.setAttribute('content', isDark ? '#121212' : '#616161');
        }
    }

    init() {
        // Storage Permission Alert handling
        const banner = document.getElementById('storageAlertBanner');
        const btnGrant = document.getElementById('btnGrantStoragePermission');
        if (banner && btnGrant) {
            const hasStored = !!window.fileSystemManager.storedHandle;
            const hasActive = !!window.fileSystemManager.dirHandle;

            if (hasStored && !hasActive) {
                banner.style.display = 'flex';
                btnGrant.onclick = async () => {
                    const success = await window.fileSystemManager.requestStoredPermission();
                    if (success) {
                        banner.style.display = 'none';
                        await this.initAsync();
                    }
                };
            } else {
                banner.style.display = 'none';
            }
        }

        try {
            this.renderSidebar();
            this.renderBoards();
            this.setupSidebarToggle();

            if (this.btnNewBoard) {
                this.btnNewBoard.onclick = () => {
                    console.log('New Board clicked');
                    this.createNewBoard();
                };

            } else {
                console.warn('btnNewBoard element not found.');
            }

            if (this.btnNewFolder) {
                this.btnNewFolder.onclick = () => {
                    console.log('New Folder clicked');
                    this.createNewFolder();
                };
            }

            // Mobile New Board
            const btnNewBoardMobile = document.getElementById('btnNewBoardMobile');
            if (btnNewBoardMobile) {
                btnNewBoardMobile.onclick = () => this.createNewBoard();
            }

            // Import Modal handling
            this.btnImport = document.getElementById('btnImport');
            const btnImportMobile = document.getElementById('btnImportMobile');
            this.importModal = document.getElementById('importModal');
            const btnCloseImportModal = document.getElementById('btnCloseImportModal');

            const btnModalUploadPDF = document.getElementById('btnModalUploadPDF');
            const btnModalOpenNcil = document.getElementById('btnModalOpenNcil');
            this.pdfInput = document.getElementById('pdfInput');
            this.ncilInput = document.getElementById('ncilInput');

            const toggleImportModal = (show) => {
                if (!this.importModal) return;
                console.log('toggleImportModal:', show);
                if (show) {
                    this.importModal.classList.add('show');
                } else {
                    this.importModal.classList.remove('show');
                }
            };

            if (this.btnImport) {
                this.btnImport.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleImportModal(true);
                };
            }
            if (btnImportMobile) {
                btnImportMobile.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleImportModal(true);
                };
            }
            if (btnCloseImportModal) {
                btnCloseImportModal.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleImportModal(false);
                };
            }

            // Close modal when clicking outside
            this.importModal?.addEventListener('click', (e) => {
                if (e.target === this.importModal) {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleImportModal(false);
                }
            });

            if (btnModalUploadPDF) {
                btnModalUploadPDF.onclick = () => {
                    toggleImportModal(false);
                    this.pdfInput.click();
                };
            }

            if (this.pdfInput) {
                this.pdfInput.onchange = (e) => this.handlePDFUpload(e);
            }

            if (btnModalOpenNcil) {
                btnModalOpenNcil.onclick = () => {
                    toggleImportModal(false);
                    if (this.app.ncilFileManager) {
                        this.app.ncilFileManager.openNcilFile();
                    } else {
                        this.ncilInput.click();
                    }
                };
            }

            if (this.ncilInput) {
                this.ncilInput.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (file && this.app.ncilFileManager) {
                        await this.app.ncilFileManager._loadFromFile(file);
                    }
                    this.ncilInput.value = '';
                };
            }

            // Template Gallery
            const btnOpenTemplates = document.getElementById('btnOpenTemplates');
            const btnOpenTemplatesMobile = document.getElementById('btnOpenTemplatesMobile');

            const triggerTemplates = (e) => {
                if (e) e.preventDefault();
                this.openTemplateGallery();
            };

            if (btnOpenTemplates) {
                btnOpenTemplates.onclick = triggerTemplates;
            }
            if (btnOpenTemplatesMobile) {
                btnOpenTemplatesMobile.onclick = triggerTemplates;
            }
            if (this.btnEmptyTrash) {
                this.btnEmptyTrash.onclick = () => this.emptyTrash();
            }

            this.setupAppNavigation();
            this.setupViewOptions();
            this.setupSearch();
            this.setupCoverModal();
            this.setupSelectAll();

            this.applyViewSettings();


            document.addEventListener('keydown', (e) => {
                // Ctrl/Cmd + S: Save
                if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                    e.preventDefault();
                    if (this.currentBoardId) {
                        this.saveCurrentBoard();
                        console.log('Saved!');
                    }
                }

                // Ctrl/Cmd + N: New note
                if ((e.ctrlKey || e.metaKey) && e.key === 'n' && this.container.style.display !== 'none') {
                    e.preventDefault();
                    this.createNewBoard();
                }

                // Ctrl/Cmd + F: Search focus
                if ((e.ctrlKey || e.metaKey) && e.key === 'f' && this.container.style.display !== 'none') {
                    e.preventDefault();
                    const visibleSearch = window.innerWidth <= 768 ? this.mobileSearchInput : this.searchInput;
                    visibleSearch?.focus();
                }

                // Escape: Clear Search or Selection
                if (e.key === 'Escape') {
                    if (this.selectedBoards.size > 0) {
                        this.clearSelection();
                    } else if (this.searchTerm) {
                        this.clearSearch();
                    }
                }

                // Ctrl/Cmd + A: Select All (only if dashboard is visible)
                if ((e.ctrlKey || e.metaKey) && e.key === 'a' && this.container.style.display !== 'none') {
                    const activeElement = document.activeElement;
                    const isInput = activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.contentEditable === 'true';

                    if (!isInput) {
                        e.preventDefault();
                        this.toggleSelectAll();
                    }
                }
            });

            // Initialize Bulk Actions Logic
            this.setupBulkActions();
            this.setupSortActions();

            this.updateBreadcrumbPath(this.currentView);
        } catch (err) {
            console.error('Dashboard init error:', err);
        }
    }

    async loadDataAsync(key, defaultValue) {
        return await window.fileSystemManager.getItem(key, defaultValue);
    }

    async saveDataAsync(key, value) {
        if (!key || key.includes('null') || key.includes('undefined')) {
            console.warn('[Dashboard] Geçersiz anahtar engellendi:', key);
            return;
        }

        // Fast purification check for IndexedDB compatibility.
        // Instead of full JSON stringify/parse which is slow on huge arrays,
        // we only perform it if we suspect the data might contain "live" objects.
        let safeValue = value;
        const heavyKeys = ['wb_boards', 'wb_folders'];
        const contentKey = key.startsWith('wb_content_');

        if (heavyKeys.includes(key) || contentKey) {
            // Note: The content itself is already mostly cleaned by serializeObj in saveCurrentBoard.
            // But if we still see errors, we might need a shallow check here.
            // For now, let's trust our improved serializeObj and only catch if put fails.
        }

        try {
            await window.fileSystemManager.saveItem(key, safeValue);
        } catch (error) {
            if (error.name === 'DataCloneError') {
                console.warn('[Dashboard] DataCloneError detected during save. Performing emergency purification for key:', key);
                try {
                    // Emergency slow pass only when actually needed
                    safeValue = JSON.parse(JSON.stringify(value));
                    await window.fileSystemManager.saveItem(key, safeValue);
                    console.info('[Dashboard] Emergency purification successful.');
                } catch (innerError) {
                    console.error('[Dashboard] Emergency purification failed:', innerError);
                }
            } else {
                throw error;
            }
        }
    }

    // Keep aliases for backward compatibility but make them async
    async loadData(key, defaultValue) {
        return await this.loadDataAsync(key, defaultValue);
    }

    async saveData(key, value) {
        await this.saveDataAsync(key, value);
    }

    isMobile() {
        return window.innerWidth <= 768;
    }

    async toggleFolder(folderId) {
        const index = this.expandedFolders.indexOf(folderId);
        if (index === -1) {
            this.expandedFolders.push(folderId);
        } else {
            this.expandedFolders.splice(index, 1);
        }
        await this.saveDataAsync('wb_expanded_folders', this.expandedFolders);
        this.renderSidebar();
    }

    showLoading() {
        if (this.loader) this.loader.style.display = 'flex';
    }

    hideLoading() {
        if (this.loader) this.loader.style.display = 'none';
    }

    renderSidebar() {
        this.folderList.innerHTML = '';

        // Prepend "All Pages" (Tüm Sayfalar) as the root folder-like item
        const allPagesItem = document.createElement('div');
        allPagesItem.className = `nav-item ${this.currentView === 'all' ? 'active' : ''}`;
        allPagesItem.dataset.view = 'all';
        allPagesItem.innerHTML = `
            <app-icon name="file-04" class="nav-icon"></app-icon>
            <span data-i18n="all_pages">${window.i18n.t('all_pages')}</span>
        `;
        allPagesItem.onclick = () => this.switchView('all');
        this.folderList.appendChild(allPagesItem);

        // Listeners for static nav items (Son Kullanılanlar, vb.)
        document.querySelectorAll('.nav-item[data-view]').forEach(item => {
            const view = item.dataset.view;
            if (view && !view.startsWith('f_')) {
                item.onclick = () => this.switchView(view);
                item.classList.toggle('active', this.currentView === view);
            }
        });

        // Handle dynamic nav items like Calendar
        const navCalendar = document.getElementById('navCalendar');
        if (navCalendar) {
            navCalendar.classList.toggle('active', this.currentView === 'calendar');
        }

        // Dynamic Folders Tree
        let rootFolders = this.folders.filter(f => !f.parentId);
        if (this.folderSortOrder === 'asc') {
            rootFolders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
        } else if (this.folderSortOrder === 'desc') {
            rootFolders.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }));
        }
        this.renderFolderTree(rootFolders, this.folderList, 0);

        // On mobile, render notes that don't have a folder at the end of the list
        if (this.isMobile()) {
            const orphanNotes = this.boards.filter(b => !b.folderId && !b.deleted);
            if (orphanNotes.length > 0) {
                const orphanSection = document.createElement('div');
                orphanSection.className = 'nav-section';
                orphanSection.innerHTML = `<div class="section-title">${window.i18n.t('other_notes')}</div>`;

                orphanNotes.forEach(note => {
                    const noteItem = document.createElement('div');
                    noteItem.className = `tree-note-item ${this.currentBoardId === note.id ? 'active' : ''}`;
                    noteItem.innerHTML = `
                        <div style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;">
                            <app-icon name="text" class="note-icon" style="width: 14px; height: 14px; opacity: 0.6;"></app-icon>
                            <span class="note-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${note.name}</span>
                        </div>
                        <div class="folder-menu-trigger">⋮</div>
                        <div class="folder-dropdown" style="width: 130px;">
                            <div class="dropdown-item" data-action="rename">
                                <app-icon name="text-cursor" style="width: 12px; opacity: 0.6;"></app-icon>
                                ${window.i18n.t('rename')}
                            </div>
                            <div class="dropdown-item" data-action="delete" style="color: #fa5252;">
                                <app-icon name="trash" style="width: 12px; opacity: 0.6; filter: invert(36%) sepia(84%) saturate(1450%) hue-rotate(338deg) brightness(98%) contrast(98%);"></app-icon>
                                ${window.i18n.t('delete')}
                            </div>
                        </div>
                    `;

                    noteItem.onclick = (e) => {
                        if (e.target.closest('.folder-menu-trigger') || e.target.closest('.folder-dropdown') || e.target.closest('.note-name[contenteditable="true"]')) return;
                        this.loadBoard(note.id);
                    };

                    const trigger = noteItem.querySelector('.folder-menu-trigger');
                    const dropdown = noteItem.querySelector('.folder-dropdown');
                    const nameEl = noteItem.querySelector('.note-name');

                    trigger.onclick = (e) => {
                        e.stopPropagation();
                        // Close other dropdowns
                        document.querySelectorAll('.folder-dropdown.show').forEach(d => {
                            if (d !== dropdown) d.classList.remove('show');
                        });
                        dropdown.classList.toggle('show');
                    };

                    dropdown.querySelector('[data-action="rename"]').onclick = (e) => {
                        e.stopPropagation();
                        dropdown.classList.remove('show');
                        nameEl.contentEditable = "true";
                        nameEl.focus();
                        document.execCommand('selectAll', false, null);

                        const saveRename = () => {
                            nameEl.contentEditable = "false";
                            this.renameBoard(note.id, nameEl.textContent);
                        };

                        nameEl.onblur = saveRename;
                        nameEl.onkeydown = (ke) => {
                            if (ke.key === 'Enter') { ke.preventDefault(); nameEl.blur(); }
                        };
                    };

                    dropdown.querySelector('[data-action="delete"]').onclick = (e) => {
                        e.stopPropagation();
                        dropdown.classList.remove('show');
                        this.deleteBoardConfirmation(note.id);
                    };

                    orphanSection.appendChild(noteItem);
                });
                this.folderList.appendChild(orphanSection);
            }
        }

        // Global click listener to close dropdowns
        if (!this.dropdownListenerAttached) {
            document.addEventListener('click', (e) => {
                if (!e.target.closest('.folder-menu-trigger')) {
                    document.querySelectorAll('.folder-dropdown.show').forEach(d => d.classList.remove('show'));
                }

                // Close board actions if clicked outside
                if (!e.target.closest('.board-actions')) {
                    document.querySelectorAll('.board-actions.show').forEach(d => {
                        d.classList.remove('show');
                        const card = d.closest('.board-card');
                        if (card) card.classList.remove('actions-open');
                    });
                }
            });
            this.dropdownListenerAttached = true;
        }

        // Re-render when window is resized to handle mobile/desktop switch
        if (!this.resizeListenerAttached) {
            window.addEventListener('resize', () => {
                this.renderSidebar();
                this.renderBoards();
            });
            this.resizeListenerAttached = true;
        }
    }

    renderFolderTree(folders, container, level) {
        folders.forEach(folder => {
            const isExpanded = this.expandedFolders.includes(folder.id);
            const hasChildren = this.folders.some(f => f.parentId === folder.id) || (this.isMobile() && this.boards.some(b => b.folderId === folder.id && !b.deleted));

            const item = document.createElement('div');
            item.className = `nav-item folder-item ${this.currentView === folder.id ? 'active' : ''} ${isExpanded ? 'expanded' : ''}`;
            item.dataset.view = folder.id;
            item.style.paddingLeft = `${12 + level * 20}px`; // Indentation for subfolders

            const folderColor = folder.color || '#ccc';
            item.innerHTML = `
                <div class="folder-content">
                    <app-icon name="arrow-dashboard" class="folder-chevron ${isExpanded ? 'rotated' : ''}" style="width: 6px; opacity: 0.4; transition: transform 0.2s; margin-right: 4px; ${hasChildren ? '' : 'visibility: hidden;'}"></app-icon>
                    <div class="folder-color-bar" style="background: ${folderColor};"></div>
                    <app-icon name="${folder.icon || 'folder'}" class="folder-icon"></app-icon>
                    <span class="folder-name" spellcheck="false" style="color: ${folderColor === '#ccc' ? 'inherit' : folderColor};">${folder.name}</span>
                </div>
                <div class="folder-menu-trigger">⋮</div>
                <div class="folder-dropdown">
                    <div class="dropdown-item" data-action="addSub">
                        <app-icon name="git-branch-01" style="width: 12px; opacity: 0.6;"></app-icon>
                        ${window.i18n.t('add_subfolder')}
                    </div>
                    ${this.isMobile() ? `
                    <div class="dropdown-item" data-action="addNote">
                        <app-icon name="add-page" style="width: 12px; opacity: 0.6;"></app-icon>
                        ${window.i18n.t('add_note')}
                    </div>
                    ` : ''}
                    <div class="dropdown-item" data-action="rename">
                        <app-icon name="text-input" style="width: 12px; opacity: 0.6;"></app-icon>
                        ${window.i18n.t('rename')}
                    </div>
                    <div class="dropdown-item" data-action="delete" style="color: #fa5252;">
                        <app-icon name="trash-02" style="width: 12px; opacity: 0.6; filter: invert(36%) sepia(84%) saturate(1450%) hue-rotate(338deg) brightness(98%) contrast(98%);"></app-icon>
                        ${window.i18n.t('delete_folder')}
                    </div>
                    <div class="folder-color-palette">
                        ${['#ccc', '#b8e994', '#ffbe76', '#ff7979', '#4a90e2', '#862e9c', '#f1c40f', '#1abc9c', '#34495e', '#7f8c8d'].map(c => `
                            <div class="color-option ${folder.color === c ? 'active' : ''}" style="background: ${c}" data-color="${c}" title="${window.i18n.t('change_color')}"></div>
                        `).join('')}
                    </div>
                    <div class="folder-icon-palette">
                        ${this.folderIcons.map(icon => `
                            <div class="icon-option ${(folder.icon || 'folder') === icon ? 'active' : ''}" data-icon="${icon}" title="${window.i18n.t('change_icon')}">
                                <app-icon name="${icon}" style="width: 14px; height: 14px;"></app-icon>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;

            const chevron = item.querySelector('.folder-chevron');
            if (hasChildren) {
                chevron.onclick = (e) => {
                    e.stopPropagation();
                    this.toggleFolder(folder.id);
                };
            }

            item.onclick = (e) => {
                if (e.target.closest('.folder-menu-trigger') || e.target.closest('.folder-dropdown') || e.target.closest('.folder-chevron')) return;

                // If it's the already active folder, toggle it. Otherwise switch view.
                if (this.currentView === folder.id) {
                    this.toggleFolder(folder.id);
                } else {
                    this.switchView(folder.id);
                    // Also auto-expand when switching to a folder
                    if (!isExpanded) {
                        this.toggleFolder(folder.id);
                    }
                }
            };

            const trigger = item.querySelector('.folder-menu-trigger');
            const dropdown = item.querySelector('.folder-dropdown');
            const nameEl = item.querySelector('.folder-name');

            trigger.onclick = (e) => {
                e.stopPropagation();
                document.querySelectorAll('.folder-dropdown.show').forEach(d => {
                    if (d !== dropdown) d.classList.remove('show');
                });
                dropdown.classList.toggle('show');
            };

            dropdown.querySelector('[data-action="addSub"]').onclick = (e) => {
                e.stopPropagation();
                dropdown.classList.remove('show');
                this.createNewFolder(folder.id);
                // Ensure parent is expanded when adding child
                if (!this.expandedFolders.includes(folder.id)) {
                    this.toggleFolder(folder.id);
                }
            };

            if (this.isMobile()) {
                dropdown.querySelector('[data-action="addNote"]').onclick = (e) => {
                    e.stopPropagation();
                    dropdown.classList.remove('show');
                    this.currentBoardId = null;
                    this.switchView(folder.id);
                    this.createNewBoard();
                    if (!this.expandedFolders.includes(folder.id)) {
                        this.toggleFolder(folder.id);
                    }
                };
            }

            dropdown.querySelector('[data-action="rename"]').onclick = (e) => {
                e.stopPropagation();
                dropdown.classList.remove('show');
                nameEl.contentEditable = "true";
                nameEl.focus();
                document.execCommand('selectAll', false, null);

                nameEl.onblur = () => {
                    nameEl.contentEditable = "false";
                    this.renameFolder(folder.id, nameEl.textContent);
                };
                nameEl.onkeydown = (ke) => {
                    if (ke.key === 'Enter') { ke.preventDefault(); nameEl.blur(); }
                };
            };

            dropdown.querySelector('[data-action="delete"]').onclick = (e) => {
                e.stopPropagation();
                dropdown.classList.remove('show');
                this.deleteFolderConfirmation(folder.id);
            };

            dropdown.querySelectorAll('.color-option').forEach(opt => {
                opt.onclick = (e) => {
                    e.stopPropagation();
                    this.changeFolderColor(folder.id, opt.dataset.color);
                    dropdown.classList.remove('show');
                };
            });
dropdown.querySelectorAll('.icon-option').forEach(opt => {
                opt.onclick = (e) => {
                    e.stopPropagation();
                    this.changeFolderIcon(folder.id, opt.dataset.icon);
                    dropdown.classList.remove('show');
                };
            });

            container.appendChild(item);

            // Container for folder children (subfolders and notes)
            if (isExpanded) {
                const childContainer = document.createElement('div');
                childContainer.className = 'folder-children';
                container.appendChild(childContainer);

                // Render subfolders
                let children = this.folders.filter(f => f.parentId === folder.id);
                if (this.folderSortOrder === 'asc') {
                    children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
                } else if (this.folderSortOrder === 'desc') {
                    children.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }));
                }
                this.renderFolderTree(children, childContainer, level + 1);

                // Render notes under this folder if on mobile
                if (this.isMobile()) {
                    const folderNotes = this.boards.filter(b => b.folderId === folder.id && !b.deleted);
                    if (this.folderSortOrder === 'asc') {
                        folderNotes.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
                    } else if (this.folderSortOrder === 'desc') {
                        folderNotes.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }));
                    }
                    folderNotes.forEach(note => {
                        const noteItem = document.createElement('div');
                        noteItem.className = `tree-note-item ${this.currentBoardId === note.id ? 'active' : ''}`;
                        noteItem.style.paddingLeft = `${32 + level * 20}px`;
                        noteItem.innerHTML = `
                            <div style="display: flex; align-items: center; gap: 8px; flex: 1; overflow: hidden;">
                                <app-icon name="text" class="note-icon" style="width: 14px; height: 14px; opacity: 0.6;"></app-icon>
                                <span class="note-name" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${note.name}</span>
                            </div>
                            <div class="folder-menu-trigger">⋮</div>
                            <div class="folder-dropdown" style="width: 130px;">
                                <div class="dropdown-item" data-action="rename">
                                    <app-icon name="text-cursor" style="width: 10px; opacity: 0.6;"></app-icon>
                                    ${window.i18n.t('rename')}
                                </div>
                                <div class="dropdown-item" data-action="share">
                                    <app-icon name="share-01" style="width: 12px; opacity: 0.6;"></app-icon>
                                    ${window.i18n.t('share_export')}
                                </div>
                                <div class="dropdown-item" data-action="delete" style="color: #fa5252;">
                                    <app-icon name="trash" style="width: 12px; opacity: 0.6; filter: invert(36%) sepia(84%) saturate(1450%) hue-rotate(338deg) brightness(98%) contrast(98%);"></app-icon>
                                    ${window.i18n.t('delete')}
                                </div>
                            </div>
                        `;

                        noteItem.onclick = (e) => {
                            if (e.target.closest('.folder-menu-trigger') || e.target.closest('.folder-dropdown') || e.target.closest('.note-name[contenteditable="true"]')) return;
                            this.loadBoard(note.id);
                        };

                        const trigger = noteItem.querySelector('.folder-menu-trigger');
                        const dropdown = noteItem.querySelector('.folder-dropdown');
                        const nameEl = noteItem.querySelector('.note-name');

                        trigger.onclick = (e) => {
                            e.stopPropagation();
                            // Close other dropdowns
                            document.querySelectorAll('.folder-dropdown.show').forEach(d => {
                                if (d !== dropdown) d.classList.remove('show');
                            });
                            dropdown.classList.toggle('show');
                        };

                        dropdown.querySelector('[data-action="rename"]').onclick = (e) => {
                            e.stopPropagation();
                            dropdown.classList.remove('show');
                            nameEl.contentEditable = "true";
                            nameEl.focus();
                            document.execCommand('selectAll', false, null);

                            const saveRename = () => {
                                nameEl.contentEditable = "false";
                                this.renameBoard(note.id, nameEl.textContent);
                            };

                            nameEl.onblur = saveRename;
                            nameEl.onkeydown = (ke) => {
                                if (ke.key === 'Enter') { ke.preventDefault(); nameEl.blur(); }
                            };
                        };

                        dropdown.querySelector('[data-action="delete"]').onclick = (e) => {
                            e.stopPropagation();
                            dropdown.classList.remove('show');
                            this.deleteBoardConfirmation(note.id);
                        };

                        dropdown.querySelector('[data-action="share"]').onclick = async (e) => {
                            e.stopPropagation();
                            dropdown.classList.remove('show');
                            if (window.fileSystemManager) {
                                await window.fileSystemManager.exportBoards([note.id]);
                            }
                        };

                        childContainer.appendChild(noteItem);
                    });
                }
            }
        });
    }

    renderBoards() {
        if (!this.boardGrid || this.currentView === 'calendar') return;
        this.applyViewSettings();
        this.boardGrid.innerHTML = '';

        if (!Array.isArray(this.boards)) this.boards = [];
        if (!Array.isArray(this.folders)) this.folders = [];

        let filteredBoards = [];
        let filteredFolders = [];

        if (this.currentView === 'trash') {
            filteredBoards = this.boards.filter(b => b.deleted);
        } else {
            // Base filter: non-deleted
            let baseBoards = this.boards.filter(b => !b.deleted);
            let baseFolders = this.folders;

            if (this.currentView === 'all') {
                // Sadece kök dizindeki (folderId'si olmayan) notları göster
                filteredBoards = baseBoards.filter(b => !b.folderId);
                // Sadece kök dizindeki (parentId'si olmayan) klasörleri göster
                filteredFolders = baseFolders.filter(f => !f.parentId);
            } else if (this.currentView === 'recent') {
                filteredBoards = [...baseBoards].sort((a, b) => b.lastModified - a.lastModified).slice(0, 10);
            } else if (this.currentView === 'favorites') {
                filteredBoards = baseBoards.filter(b => b.favorite);
            } else if (this.currentView.startsWith('f_')) {
                // Seçili klasörün içindeki notları ve alt klasörleri göster
                filteredBoards = baseBoards.filter(b => b.folderId === this.currentView);
                filteredFolders = baseFolders.filter(f => f.parentId === this.currentView);
            } else {
                filteredBoards = baseBoards;
            }
        }

        // Apply Sorting to Folders (Alphabetical)
        filteredFolders.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

        // Apply custom sorting to Boards
        if (this.boardSortField === 'name') {
            filteredBoards.sort((a, b) => this.boardSortOrder === 'asc' 
                ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) 
                : b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' }));
        } else if (this.boardSortField === 'date') {
            filteredBoards.sort((a, b) => this.boardSortOrder === 'asc' 
                ? a.lastModified - b.lastModified 
                : b.lastModified - a.lastModified);
        } else if (this.boardSortField === 'size') {
            filteredBoards.sort((a, b) => this.boardSortOrder === 'asc' 
                ? (a.objectCount || 0) - (b.objectCount || 0) 
                : (b.objectCount || 0) - (a.objectCount || 0));
        }

        // Apply Search Filter
        if (this.searchTerm) {
            const term = this.searchTerm.toLowerCase();
            filteredBoards = filteredBoards.filter(b => b.name.toLowerCase().includes(term));
            filteredFolders = filteredFolders.filter(f => f.name.toLowerCase().includes(term));
        }

        this.updateSelectAllButtonState(filteredBoards);
        this.updateTodayNotesBadge();

        // Render Empty States
        if (filteredBoards.length === 0 && filteredFolders.length === 0) {
            if (this.currentView === 'trash') {
                this.boardGrid.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">
                        <app-icon name="trash-01" style="width: 36px; height: 36px; opacity: 0.7;"></app-icon>
                        </div>
                        <h3 data-i18n="empty_trash_desc">${window.i18n.t('empty_trash_desc')}</h3>
                    </div>
                `;
                return;
            }

            if (this.searchTerm) {
                this.boardGrid.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🔍</div>
                        <h3 data-i18n="no_search_results">${window.i18n.t('no_search_results').replace('{searchTerm}', this.searchTerm)}</h3>
                        <button class="btn btn-secondary" id="btnClearSearchGeneric" data-i18n="clear_search">${window.i18n.t('clear_search')}</button>
                    </div>
                `;
                this.boardGrid.querySelector('#btnClearSearchGeneric').onclick = () => this.clearSearch();
                return;
            }

            if (this.currentView !== 'trash') {
                this.boardGrid.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">
                        <app-icon name="file-04" style="width: 36px; height: 36px; opacity: 0.7;"></app-icon>
                        </div>
                        <h3 data-i18n="no_notes">${window.i18n.t('no_notes')}</h3>
                        <p data-i18n="no_notes_desc">${window.i18n.t('no_notes_desc')}</p>
                        <button class="btn btn-primary" id="btnCreateFirstNote" data-i18n="create_first_note">
                            ${window.i18n.t('create_first_note')}
                        </button>
                    </div>
                `;
                const btn = this.boardGrid.querySelector('#btnCreateFirstNote');
                if (btn) btn.onclick = () => this.createNewBoard();
                return;
            }
        }

        // 1. Render Folders
        filteredFolders.forEach(folder => {
            const card = document.createElement('div');
            card.className = 'board-card folder-card';
            card.dataset.id = folder.id;
            
            card.innerHTML = `
                <div class="folder-grid-icon-container">
                    <app-icon name="folder-dashboard" class="folder-grid-icon"></app-icon>
                </div>
                <div class="board-info">
                    <div class="board-title">${folder.name}</div>
                    <div class="board-meta">
                        <span data-i18n="folder">Klasör</span>
                    </div>
                </div>
            `;
            
            card.onclick = () => {
                this.switchView(folder.id);
            };
            
            this.boardGrid.appendChild(card);
        });

        // 2. Render Boards
        filteredBoards.forEach(board => {
            const card = document.createElement('div');
            card.className = `board-card ${this.selectedBoards.has(board.id) ? 'selected' : ''}`;
            card.dataset.id = board.id;

            // Check if recent (last 24 hours)
            const isRecent = (Date.now() - board.lastModified) < (24 * 60 * 60 * 1000);
            if (isRecent && this.currentView === 'all') {
                card.dataset.recent = "true";
            }

            const hasImage = board.coverImage;
            const coverBg = board.coverBg || '#4a90e2';
            const paperTexture = board.paperTexture || board.coverTexture || 'none';
            const metallicDetail = board.metallicDetail || 'none';
            const labelStyle = board.labelStyle || 'none';
            const showFolderIcon = board.showFolderIcon || false;

            let coverClasses = `notebook-cover`;
            if (!hasImage && paperTexture !== 'none') coverClasses += ` cover-texture-${paperTexture}`;
            if (!hasImage && metallicDetail !== 'none') coverClasses += ` cover-detail-${metallicDetail}`;

            let labelHTML = '';
            if (labelStyle !== 'none') {
                labelHTML = `
                    <div class="notebook-cover-label label-style-${labelStyle}">
                        <div class="label-title">${board.name}</div>
                        <div class="label-date">${new Date(board.lastModified).toLocaleDateString()}</div>
                    </div>
                `;
            }

            let folderIconHTML = '';
            if (showFolderIcon && board.folderId) {
                const folder = this.folders.find(f => f.id === board.folderId);
                if (folder) {
                    folderIconHTML = `
                        <div class="cover-folder-icon">
                            <app-icon name="${folder.icon || 'folder'}" size="14"></app-icon>
                        </div>
                    `;
                }
            }

            const notebookCoverHTML = `<div class="${coverClasses}"
                         style="background-color: ${coverBg}; ${hasImage ? `background-image: url(${board.coverImage}); background-size: cover; background-position: center;` : ''}">
                        ${board.isPDF
                    ? `<app-icon name="pdf" style="width: 64px; height: 64px; opacity: 0.8; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.2));"></app-icon>`
                    : ''
                }
                        ${labelHTML}
                        ${folderIconHTML}
                        <div class="notebook-spine"></div>
                   </div>`;

            card.innerHTML = `
                <div class="board-selection" onclick="event.stopPropagation()">
                    <input type="checkbox" class="board-checkbox" 
                           ${this.selectedBoards.has(board.id) ? 'checked' : ''}>
                </div>

                <div class="notebook-container">
                    ${notebookCoverHTML}
                </div>

                <div class="board-info">
                    <div class="board-title" contenteditable="true" spellcheck="false">${board.name}</div>
                    <div class="board-meta">
                        <span>${new Date(board.lastModified).toLocaleDateString()}</span>
                        ${board.isNcilFile ? '<span class="tag-ncil">.ncil</span>' : ''}
                    </div>
                </div>
            `;

            card.querySelector('.board-checkbox').onchange = (e) => {
                this.toggleBoardSelection(board.id, e.target.checked);
            };

            card.onclick = (e) => {
                // Ignore clicks on title and selection
                if (e.target.classList.contains('board-title') ||
                    e.target.closest('.board-selection')) {
                    return;
                }

                // If in bulk mode (at least one selected), clicking card selects it
                if (this.selectedBoards.size > 0 || e.shiftKey) {
                    this.toggleBoardSelection(board.id, !this.selectedBoards.has(board.id));
                    return;
                }

                this.loadBoard(board.id);
            };

            // Long Press for Mobile Selection
            let pressTimer;
            card.addEventListener('touchstart', (e) => {
                pressTimer = setTimeout(() => {
                    this.toggleBoardSelection(board.id, true);
                    navigator.vibrate?.(50); // Haptic feedback
                }, 600);
            }, { passive: true });

            card.addEventListener('touchend', () => clearTimeout(pressTimer), { passive: true });
            card.addEventListener('touchmove', () => clearTimeout(pressTimer), { passive: true });

            // Title editing
            const titleEl = card.querySelector('.board-title');
            titleEl.onblur = () => this.renameBoard(board.id, titleEl.textContent);
            titleEl.onkeydown = (e) => {
                if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); }
            };

            this.boardGrid.appendChild(card);
        });

        this.setupBoardDragDrop();

        // Add "Create New" card at the end
        if (this.currentView !== 'trash' && !this.searchTerm) {
            const createCard = document.createElement('div');
            createCard.className = 'board-card create-new-card';
            createCard.innerHTML = `
                <div class="notebook-container">
                    <div class="notebook-cover-dashed">
                        <span class="dashed-plus-icon">+</span>
                    </div>
                </div>
                <div class="board-info">
                    <div class="board-title" style="color: #999;">${window.i18n.t('new_note_default')}</div>
                </div>
            `;
            createCard.onclick = () => {
                this.createNewBoard();
            };
            this.boardGrid.appendChild(createCard);
        }
    }

    async switchView(view) {
        if (window.calendar && view !== 'calendar') {
            window.calendar.hide();
        } else if (window.calendar && view === 'calendar') {
            window.calendar.show();
        }
        this.currentView = view;
        const folder = this.folders.find(f => f.id === view);
        const titles = {
            all: window.i18n.t('all_pages_title'),
            recent: window.i18n.t('recent_title'),
            favorites: window.i18n.t('favorites_title'),
            trash: window.i18n.t('trash_title'),
            calendar: window.i18n.t('calendar')
        };
        const title = titles[view] || (folder ? folder.name : window.i18n.t('folder_default_name'));
        if (this.breadcrumb) this.breadcrumb.textContent = `${APP_CONFIG.NAME} / ${title}`;

        // Update navigation path row
        this.updateBreadcrumbPath(view);

        // Show/Hide Empty Trash button
        if (this.btnEmptyTrash) {
            this.btnEmptyTrash.style.display = (view === 'trash') ? 'flex' : 'none';
        }

        this.renderSidebar();
        this.renderBoards();

        // Close sidebar on mobile after switching view
        if (window.innerWidth <= 768) {
            const sidebar = document.querySelector('.dashboard-sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            this.sidebarCollapsed = true;
            sidebar?.classList.add('collapsed');
            overlay?.classList.remove('show');
        }
    }

    async createNewFolder(parentId = null) {
        const id = 'f_' + Date.now();

        // Find a unique name
        const baseName = window.i18n.t('new_folder_default');
        let name = baseName;
        let counter = 1;
        const existingNames = this.folders.map(f => f.name.trim());

        if (existingNames.includes(baseName)) {
            while (existingNames.includes(`${baseName} ${counter}`)) {
                counter++;
            }
            name = `${baseName} ${counter}`;
        }

        const newFolder = {
            id: id,
            name: name,
            created: Date.now(),
            parentId: parentId
        };
        // Position at top of dynamic list
        this.folders.unshift(newFolder);
        await this.saveDataAsync('wb_folders', this.folders);
        await this.switchView(id);

        // Auto focus for renaming
        setTimeout(() => {
            const nameEl = document.querySelector(`.nav-item[data-view="${id}"] .folder-name`);
            if (nameEl) {
                nameEl.contentEditable = "true";
                nameEl.focus();
                document.execCommand('selectAll', false, null);

                nameEl.onblur = () => {
                    nameEl.contentEditable = "false";
                    this.renameFolder(id, nameEl.textContent);
                };
                nameEl.onkeydown = (ke) => {
                    if (ke.key === 'Enter') { ke.preventDefault(); nameEl.blur(); }
                };
            }
        }, 150);
    }

    setupSidebarToggle() {
        const sidebar = document.querySelector('.dashboard-sidebar');
        const toggleBtn = document.getElementById('btnSidebarToggle');
        const mobileToggleBtn = document.getElementById('btnMobileMenuToggle');
        const overlay = document.getElementById('sidebarOverlay');

        if (!sidebar) return;

        // Auto-collapse on mobile initially
        if (window.innerWidth <= 768) {
            this.sidebarCollapsed = true;
            sidebar.classList.add('collapsed');
        }

        // Apply initial state from storage (only for desktop)
        if (window.innerWidth > 768 && this.sidebarCollapsed) {
            sidebar.classList.add('collapsed');
            if (toggleBtn) toggleBtn.title = window.i18n.t('menu_open');
        }

        const updateUI = () => {
            sidebar.classList.toggle('collapsed', this.sidebarCollapsed);
            if (toggleBtn) toggleBtn.title = this.sidebarCollapsed ? window.i18n.t('menu_open') : window.i18n.t('menu_close');
            
            // Handle overlay on mobile
            if (window.innerWidth <= 768) {
                if (this.sidebarCollapsed) {
                    overlay?.classList.remove('show');
                } else {
                    overlay?.classList.add('show');
                }
            }
        };

        if (toggleBtn) {
            toggleBtn.onclick = (e) => {
                e.stopPropagation();
                this.sidebarCollapsed = !this.sidebarCollapsed;
                updateUI();
                if (window.innerWidth > 768) {
                    this.saveDataAsync('wb_sidebar_collapsed', this.sidebarCollapsed);
                }
            };
        }

        if (mobileToggleBtn) {
            mobileToggleBtn.onclick = (e) => {
                e.stopPropagation();
                this.sidebarCollapsed = false;
                updateUI();
            };
        }

        if (overlay) {
            overlay.onclick = () => {
                this.sidebarCollapsed = true;
                updateUI();
            };
        }
    }

    setupSettingsModal() {
        const btnSettingsToggle = document.getElementById('btnSidebarSettingsToggle');
        const btnViewOptions = document.getElementById('btnSidebarViewOptions');
        const btnViewOptionsMobile = document.getElementById('btnViewOptionsMobile');
        const btnStorageSettings = document.getElementById('btnStorageSettings');
        
        const modal = document.getElementById('settingsModal');
        const btnClose = document.getElementById('btnCloseSettingsModal');
        const sidebarItems = modal.querySelectorAll('.settings-sidebar-item');
        const tabContents = modal.querySelectorAll('.settings-tab-content');
        const tabTitle = document.getElementById('settingsTabTitle');

        if (!modal) return;

        // ─── Tab Switch Logic ────────────────────────────────────
        const switchTab = (tabId) => {
            sidebarItems.forEach(item => {
                item.classList.toggle('active', item.dataset.tab === tabId);
            });
            tabContents.forEach(content => {
                content.classList.toggle('active', content.id === `tab-${tabId}`);
            });
            
            // Update title
            if (tabId === 'appearance') tabTitle.textContent = window.i18n.t('view_settings');
            else if (tabId === 'language') {
                tabTitle.textContent = window.i18n.t('language');
                this.renderLanguageList();
            }
            else if (tabId === 'workspace') tabTitle.textContent = window.i18n.t('workspace');
            else if (tabId === 'storage') {
                tabTitle.textContent = window.i18n.t('storage');
                updateStorageUI();
            }
            else if (tabId === 'about') {
                tabTitle.textContent = window.i18n.t('about') || 'Notencil Hakkında';
            }
        };

        // Language changed listener to update dynamic parts
        window.addEventListener('languageChanged', () => {
            const activeTab = Array.from(sidebarItems).find(item => item.classList.contains('active'))?.dataset.tab;
            if (activeTab === 'appearance') tabTitle.textContent = window.i18n.t('view_settings');
            else if (activeTab === 'language') {
                tabTitle.textContent = window.i18n.t('language');
                this.renderLanguageList();
            }
            else if (activeTab === 'workspace') tabTitle.textContent = window.i18n.t('workspace');
            else if (activeTab === 'storage') tabTitle.textContent = window.i18n.t('storage');
            else if (activeTab === 'about') tabTitle.textContent = window.i18n.t('about') || 'Notencil Hakkında';
            
            this.renderBoards();
            this.renderSidebar();
            updateStorageUI();
        });

        sidebarItems.forEach(item => {
            item.onclick = () => switchTab(item.dataset.tab);
        });

        // ─── Open/Close Logic ────────────────────────────────────
        const openModal = (tab = 'appearance') => {
            modal.style.display = 'flex';
            modal.classList.add('show');
            switchTab(tab);
        };

        const closeModal = () => {
            modal.style.display = 'none';
            modal.classList.remove('show');
        };

        if (btnSettingsToggle) btnSettingsToggle.onclick = () => openModal('appearance');
        if (btnViewOptions) btnViewOptions.onclick = (e) => { e.stopPropagation(); openModal('appearance'); };
        if (btnViewOptionsMobile) btnViewOptionsMobile.onclick = (e) => { e.stopPropagation(); openModal('appearance'); };
        if (btnStorageSettings) btnStorageSettings.onclick = (e) => { e.stopPropagation(); openModal('storage'); };
        
        if (btnClose) btnClose.onclick = closeModal;
        modal.onclick = (e) => { if (e.target === modal) closeModal(); };

        // ─── Storage Settings Logic (Moved from setupStorageSettings) ───
        const btnPick = document.getElementById('btnChangeStorageLocation');
        const btnScan = document.getElementById('btnScanStorageFolder');
        const btnReset = document.getElementById('btnResetStorageLocation');
        const statusText = document.getElementById('currentStorageLocation');

        // CloudStorageManager başlat
        if (window.CloudStorageManager && !this._cloudStorage) {
            this._cloudStorage = new window.CloudStorageManager(this);
        }

        const updateStorageUI = () => {
            if (!statusText) return;
            const mode = window.fileSystemManager.mode;
            const hasDir = !!window.fileSystemManager.dirHandle;
            const hasStored = !!window.fileSystemManager.storedHandle;
            const isFileSystemSupported = !!window.showDirectoryPicker;
            const platform = window.CloudStorageManager ? window.CloudStorageManager.detect() : { isMobile: false };

            if (mode === 'native' && hasDir) {
                statusText.innerHTML = `${window.i18n.t('current_location')}: <strong style="color: var(--app-icon-color);">${window.i18n.t('local_folder')} (${window.fileSystemManager.dirHandle.name})</strong>`;
            } else if (mode === 'native' && hasStored) {
                statusText.innerHTML = `${window.i18n.t('current_location')}: <strong style="color: #f08c00">${window.i18n.t('waiting_permission')} (${window.fileSystemManager.storedHandle.name})</strong>`;
            } else {
                statusText.innerHTML = `${window.i18n.t('current_location')}: <strong>${window.i18n.t('indexeddb_label')}</strong>`;
            }

            const supportNote = document.getElementById('folderPickerSupportNote');
            if (isFileSystemSupported) {
                btnPick.style.display = 'flex';
                if (hasDir) {
                    btnPick.innerHTML = `<app-icon name="folder" style="width: 16px; margin-right: 8px; filter: brightness(0) invert(1);"></app-icon> ${window.i18n.t('change_folder')}`;
                    btnPick.className = 'btn btn-primary';
                } else if (hasStored) {
                    btnPick.innerHTML = `<app-icon name="folder" style="width: 16px; margin-right: 8px; filter: brightness(0) invert(1);"></app-icon> ${window.i18n.t('grant_access')}`;
                    btnPick.className = 'btn btn-warning';
                } else {
                    btnPick.innerHTML = `<app-icon name="folder" style="width: 16px; margin-right: 8px; filter: brightness(0) invert(1);"></app-icon> ${window.i18n.t('select_or_create_folder')}`;
                    btnPick.className = 'btn btn-primary';
                }
                if (supportNote) supportNote.style.display = 'none';
            } else {
                btnPick.style.display = 'none';
                if (supportNote) {
                    supportNote.style.display = 'block';
                    supportNote.innerHTML = platform.isMobile ? 
                        window.i18n.t('mobile_db_note') :
                        window.i18n.t('browser_no_fs_support');
                }
            }

            const isNative = mode === 'native' && hasDir;
            btnReset.style.display = (mode === 'native' || hasStored) ? 'flex' : 'none';
            if (btnScan) btnScan.style.display = isNative ? 'flex' : 'none';
        };

        btnPick.onclick = async () => {
            const success = await window.fileSystemManager.pickStorageFolder();
            if (success) {
                updateStorageUI();
                await this.initAsync();
            }
        };

        if (btnScan) {
            btnScan.onclick = async () => {
                btnScan.disabled = true;
                const originalHTML = btnScan.innerHTML;
                btnScan.innerHTML = window.i18n.t('scanning');
                const result = await window.fileSystemManager.importFromNative();
                btnScan.disabled = false;
                btnScan.innerHTML = originalHTML;
                if (result.success) {
                    Utils.showToast(window.i18n.t('import_scan_result').replace('{boards}', result.boards).replace('{folders}', result.folders), 'success');
                    await this.initAsync();
                } else {
                    Utils.showToast(window.i18n.t('import_error_msg').replace('{error}', result.error), 'error');
                }
            };
        }

        btnReset.onclick = async () => {
            const confirmed = await Utils.showConfirm({
                title: window.i18n.t('reset_storage_title'),
                message: window.i18n.t('reset_storage_msg'),
                confirmText: window.i18n.t('reset_btn'),
                type: 'warning'
            });
            if (confirmed) {
                await window.fileSystemManager.db.settings.delete('folder_handle');
                window.fileSystemManager.dirHandle = null;
                window.fileSystemManager.storedHandle = null;
                window.fileSystemManager.mode = 'indexeddb';
                updateStorageUI();
                await this.initAsync();
            }
        };

        // ─── Appearance Settings Logic ───────────────────────────
        const gridSizeOptions = document.getElementById('gridSizeOptions');
        if (gridSizeOptions) {
            const radios = gridSizeOptions.querySelectorAll('input[name="gridSize"]');
            const currentVal = this.viewSettings.gridSize || 'xsmall';
            
            radios.forEach(radio => {
                if (radio.value === currentVal) radio.checked = true;
                radio.onchange = async () => {
                    if (radio.checked) {
                        this.viewSettings.gridSize = radio.value;
                        await this.saveDataAsync('wb_view_settings', this.viewSettings);
                        this.renderBoards(); // UI'ı yenile
                        Utils.showToast(window.i18n.t('view_setting_updated'), 'success');
                    }
                };
            });
        }

        const settingsIconColorPicker = document.getElementById('settingsIconColorPicker');
        const btnSettingsApplyIconColor = document.getElementById('btnSettingsApplyIconColor');
        const btnSettingsResetIconColor = document.getElementById('btnSettingsResetIconColor');

        if (settingsIconColorPicker) {
            settingsIconColorPicker.value = this.viewSettings.iconColor || '#616161';
            
            if (btnSettingsApplyIconColor) {
                 btnSettingsApplyIconColor.onclick = async () => {
                     const color = settingsIconColorPicker.value;
                     this.viewSettings.iconColor = color;
                     document.documentElement.style.setProperty('--app-icon-color', color);
                     
                     // Sync with other picker if exists
                     const otherPicker = document.getElementById('uiIconColorPicker');
                     if (otherPicker) otherPicker.value = color;

                     await this.saveDataAsync('wb_view_settings', this.viewSettings);
                     Utils.showToast(window.i18n.t('appearance_setting_updated'), 'success');
                 };
             }
 
             if (btnSettingsResetIconColor) {
                 btnSettingsResetIconColor.onclick = async () => {
                     const defaultColor = '#616161';
                     settingsIconColorPicker.value = defaultColor;
                     this.viewSettings.iconColor = defaultColor;
                     document.documentElement.style.setProperty('--app-icon-color', defaultColor);

                     // Sync with other picker if exists
                     const otherPicker = document.getElementById('uiIconColorPicker');
                     if (otherPicker) otherPicker.value = defaultColor;

                     await this.saveDataAsync('wb_view_settings', this.viewSettings);
                     Utils.showToast(window.i18n.t('appearance_setting_updated'), 'success');
                 };
             }
        }

        // ─── Workspace Settings Logic ────────────────────────────
        const checkDarkTheme = document.getElementById('checkDarkTheme');
        if (checkDarkTheme) {
            checkDarkTheme.checked = this.viewSettings.darkTheme === true;
            checkDarkTheme.onchange = async () => {
                this.viewSettings.darkTheme = checkDarkTheme.checked;
                this.applyTheme();
                await this.saveDataAsync('wb_view_settings', this.viewSettings);
                Utils.showToast(window.i18n.t('appearance_setting_updated'), 'success');
            };
        }

        const checkRememberLastPage = document.getElementById('checkRememberLastPage');
        if (checkRememberLastPage) {
            checkRememberLastPage.checked = this.viewSettings.rememberLastPage !== false;
            checkRememberLastPage.onchange = async () => {
                this.viewSettings.rememberLastPage = checkRememberLastPage.checked;
                await this.saveDataAsync('wb_view_settings', this.viewSettings);
                Utils.showToast(window.i18n.t('workspace_setting_updated'), 'success');
            };
        }

        // ─── Otomatik Kayıt Ayarları ──────────────────────────────
        const autosaveOptions = document.getElementById('autosaveOptions');
        if (autosaveOptions) {
            const radios = autosaveOptions.querySelectorAll('input[name="autosaveInterval"]');
            const currentVal = this.viewSettings.autosaveInterval || 'off';
            radios.forEach(radio => {
                if (radio.value === currentVal) radio.checked = true;
                radio.onchange = async () => {
                    if (radio.checked) {
                        this.viewSettings.autosaveInterval = radio.value;
                        await this.saveDataAsync('wb_view_settings', this.viewSettings);
                        Utils.showToast(window.i18n.t('autosave_setting_updated'), 'success');
                    }
                };
            });
        }

        // Mobil Yedekleme Butonları
        this._setupMobileStorageButtons();
    }

    _setupMobileStorageButtons() {
        const statusEl = document.getElementById('gdrive-status');
        const setStatus = (msg, isError = false) => {
            if (!statusEl) return;
            statusEl.textContent = msg;
            statusEl.style.color = isError ? '#fa5252' : '#2b8a3e';
        };

        const getCloud = () => {
            if (!this._cloudStorage && window.CloudStorageManager) {
                this._cloudStorage = new window.CloudStorageManager(this);
            }
            return this._cloudStorage;
        };

        // ─── JSON İndir ───────────────────────────────────────────
        const btnExport = document.getElementById('btn-export-json');
        if (btnExport) {
            btnExport.onclick = async () => {
                btnExport.disabled = true;
                btnExport.textContent = window.i18n.t('preparing');
                const result = await getCloud().exportToFile();
                btnExport.disabled = false;
                btnExport.innerHTML = window.i18n.t('download_as_json');
                Utils.showToast(result.message, 'info');
            };
        }

        // ─── JSON Yükle ───────────────────────────────────────────
        const btnImport = document.getElementById('btn-import-json');
        if (btnImport) {
            btnImport.onclick = async () => {
                const result = await getCloud().importFromFile();
                if (result.success) {
                    Utils.showToast(result.message, 'success');
                    await this.initAsync();
                } else if (result.message) {
                    Utils.showToast(window.i18n.t('import_error_msg').replace('{error}', result.message), 'error');
                }
            };
        }

        // ─── Google Drive: Kaydet ─────────────────────────────────
        const btnGDriveSave = document.getElementById('btn-gdrive-save');
        if (btnGDriveSave) {
            btnGDriveSave.onclick = async () => {
                setStatus(window.i18n.t('saving'));
                btnGDriveSave.disabled = true;
                try {
                    const result = await getCloud().saveToGoogleDrive();
                    if (result.success) {
                        setStatus('✅ ' + result.message);
                        // Refresh dashboard to show discovered or synced items
                        setTimeout(async () => {
                            await this.initAsync();
                        }, 1000);
                    } else {
                        setStatus('ℹ️ ' + result.message);
                    }
                    
                    // Google oturumu açıksa çıkış butonunu göster
                    const signOutBtn = document.getElementById('btn-gdrive-signout');
                    if (signOutBtn) signOutBtn.style.display = 'flex';
                } catch (e) {
                    setStatus('❌ ' + e.message, true);
                }
                btnGDriveSave.disabled = false;
            };
        }

        // ─── Google Drive: Yükle ──────────────────────────────────
        const btnGDriveLoad = document.getElementById('btn-gdrive-load');
        if (btnGDriveLoad) {
            btnGDriveLoad.onclick = async () => {
                setStatus(window.i18n.t('loading_gdrive'));
                btnGDriveLoad.disabled = true;
                try {
                    const result = await getCloud().loadFromGoogleDrive();
                    if (result.success) {
                        setStatus('✅ ' + result.message);
                        const signOutBtn = document.getElementById('btn-gdrive-signout');
                        if (signOutBtn) signOutBtn.style.display = 'flex';
                        setTimeout(async () => {
                            await this.initAsync();
                        }, 1500);
                    } else {
                        setStatus('ℹ️ ' + result.message);
                    }
                } catch (e) {
                    setStatus('❌ ' + e.message, true);
                }
                btnGDriveLoad.disabled = false;
            };
        }

        // ─── Google Drive: Çıkış ──────────────────────────────────
        const btnSignOut = document.getElementById('btn-gdrive-signout');
        if (btnSignOut) {
            // Eğer token kayıtlıysa göster
            if (localStorage.getItem(`${APP_CONFIG.STORAGE_PREFIX}gdrive_token`)) {
                btnSignOut.style.display = 'flex';
            }
            btnSignOut.onclick = async () => {
                await getCloud().signOutGoogle();
                btnSignOut.style.display = 'none';
                setStatus(window.i18n.t('signed_out_gdrive'));
            };
        }
    }

    updateBreadcrumbPath(viewId) {
        if (!this.breadcrumbPathRow || !this.breadcrumbPathText) return;

        const titles = {
            all: window.i18n.t('all_pages_title'),
            recent: window.i18n.t('recent_title'),
            favorites: window.i18n.t('favorites_title'),
            trash: window.i18n.t('trash_title'),
            calendar: window.i18n.t('calendar')
        };

        let path = [];
        const folder = this.folders.find(f => f.id === viewId);

        if (folder) {
            path = [folder.name];
            let current = folder;
            while (current.parentId) {
                const parent = this.folders.find(f => f.id === current.parentId);
                if (parent) {
                    path.unshift(parent.name);
                    current = parent;
                } else {
                    break;
                }
            }
        } else {
            path = [titles[viewId] || window.i18n.t('folder_default_name')];
        }

        path.unshift(APP_CONFIG.NAME); // "notencil"
        this.breadcrumbPathText.textContent = path.join(' / ');
        this.breadcrumbPathRow.style.display = 'flex';
    }

    async renameFolder(id, newName) {
        const folder = this.folders.find(f => f.id === id);
        if (folder && newName.trim()) {
            folder.name = newName.trim();
            await this.saveDataAsync('wb_folders', this.folders);
            this.renderSidebar();
            if (this.currentView === id) {
                if (this.breadcrumb) this.breadcrumb.textContent = `${APP_CONFIG.NAME} / ${folder.name}`;
                if (this.breadcrumbPathText) {
                    this.updateBreadcrumbPath(id);
                }
            }
        } else {
            this.renderSidebar();
        }
    }

    async changeFolderColor(id, color) {
        const folder = this.folders.find(f => f.id === id);
        if (folder) {
            folder.color = color;
            await this.saveDataAsync('wb_folders', this.folders);
            this.renderSidebar();
        }
    }

    async changeFolderIcon(id, icon) {
        const folder = this.folders.find(f => f.id === id);
        if (folder) {
            folder.icon = icon;
            await this.saveDataAsync('wb_folders', this.folders);
            this.renderSidebar();
        }
    }

    async deleteFolder(id) {
        const getAllChildren = (folderId) => {
            let result = [folderId];
            this.folders.filter(f => f.parentId === folderId).forEach(child => {
                result = result.concat(getAllChildren(child.id));
            });
            return result;
        };

        const idsToDelete = getAllChildren(id);

        // Bu klasörlerdeki board içeriklerini (native + IndexedDB) sil
        const boardsInFolders = this.boards.filter(b => idsToDelete.includes(b.folderId));
        await Promise.all(boardsInFolders.map(b =>
            window.fileSystemManager.removeItem(`wb_content_${b.id}`)
        ));

        // Native'de klasör yapısını temizle
        if (window.fileSystemManager.mode === 'native' && window.fileSystemManager.dirHandle) {
            const rootFolderPath = window.fileSystemManager._getFolderPath(id);
            if (rootFolderPath.length > 0) {
                try {
                    let parentDir = window.fileSystemManager.dirHandle;
                    for (let i = 0; i < rootFolderPath.length - 1; i++) {
                        parentDir = await parentDir.getDirectoryHandle(rootFolderPath[i], { create: false });
                    }
                    await parentDir.removeEntry(rootFolderPath[rootFolderPath.length - 1], { recursive: true }).catch(() => { });
                } catch (e) { }
            }
        }

        this.boards = this.boards.filter(b => !idsToDelete.includes(b.folderId));
        await this.saveDataAsync('wb_boards', this.boards);

        this.folders = this.folders.filter(f => !idsToDelete.includes(f.id));
        await this.saveDataAsync('wb_folders', this.folders);

        // Drive'dan anında sil (trash'e at)
        this._syncDeletionToDrive([...idsToDelete, ...boardsInFolders.map(b => b.id)]);

        // Senkronizasyon için silindiğini işaretle (Klasörler + Boardlar)
        const deletedIds = await this.loadDataAsync('wb_deleted_ids', []);
        let changed = false;

        // Klasör ID'lerini ekle
        idsToDelete.forEach(id => {
            if (!deletedIds.includes(id)) {
                deletedIds.push(id);
                changed = true;
            }
        });

        // Bu klasörlerdeki board ID'lerini de ekle
        boardsInFolders.forEach(b => {
            if (!deletedIds.includes(b.id)) {
                deletedIds.push(b.id);
                changed = true;
            }
        });
        if (changed) await this.saveDataAsync('wb_deleted_ids', deletedIds);

        if (idsToDelete.includes(this.currentView)) {
            this.switchView('all');
        } else {
            this.renderSidebar();
            this.renderBoards();
        }
    }

    async deleteFolderConfirmation(id) {
        const folder = this.folders.find(f => f.id === id);
        if (!folder) return;

        const confirmed = await Utils.showConfirm({
            title: window.i18n.t('delete_folder_title'),
            message: window.i18n.t('delete_folder_msg').replace('{name}', folder.name),
            confirmText: window.i18n.t('delete'),
            type: 'danger'
        });

        if (confirmed) {
            this.deleteFolder(id);
        }
    }

    async deleteBoardConfirmation(id) {
        const board = this.boards.find(b => b.id === id);
        if (!board) return;

        const msg = board.deleted
            ? window.i18n.t('delete_board_permanent_msg').replace('{name}', board.name)
            : window.i18n.t('delete_board_trash_msg').replace('{name}', board.name);
        const title = board.deleted ? window.i18n.t('delete_board_permanent_title') : window.i18n.t('delete_board_trash_title');
        const btnText = board.deleted ? window.i18n.t('delete_board_permanent_btn') : window.i18n.t('delete_board_trash_btn');

        const confirmed = await Utils.showConfirm({
            title,
            message: msg,
            confirmText: btnText,
            type: 'danger'
        });

        if (confirmed) {
            this.deleteBoard(id);
        }
    }

    setupBoardDragDrop() {
        const cards = document.querySelectorAll('.board-card:not(.create-new-card)');
        cards.forEach(card => {
            card.draggable = true;
            card.ondragstart = (e) => {
                e.dataTransfer.setData('boardId', card.dataset.id);
                card.classList.add('dragging');
            };
            card.ondragend = () => card.classList.remove('dragging');
        });

        // Add drop support to folder items in sidebar
        document.querySelectorAll('.folder-item').forEach(folder => {
            folder.ondragover = (e) => {
                e.preventDefault();
                folder.classList.add('drop-target');
            };
            folder.ondragleave = () => folder.classList.remove('drop-target');
            folder.ondrop = (e) => {
                e.preventDefault();
                const boardId = e.dataTransfer.getData('boardId');
                const folderId = folder.dataset.view;
                this.moveBoardToFolder(boardId, folderId);
                folder.classList.remove('drop-target');
            };
        });
    }

    async createNewBoard() {
        console.log('createNewBoard başlatıldı');
        const id = 'b_' + Date.now();

        // Find a unique name like "Not", "Not 1", "Not 2", etc.
        const baseName = window.i18n.t('new_note_default');
        let name = baseName;
        let counter = 1;
        const existingNames = this.boards.filter(b => !b.deleted).map(b => b.name.trim());

        if (existingNames.includes(baseName)) {
            while (existingNames.includes(`${baseName} ${counter}`)) {
                counter++;
            }
            name = `${baseName} ${counter}`;
        }

        const newBoard = {
            id: id,
            name: name,
            lastModified: Date.now(),
            favorite: false,
            deleted: false,
            objectCount: 0,
            preview: null,
            folderId: this.currentView.startsWith('f_') ? this.currentView : null,
            coverBg: '#4a90e2',
            coverTexture: 'none'
        };

        this.boards.push(newBoard);
        await this.saveDataAsync('wb_boards', this.boards);

        // Refresh dashboard
        this.renderBoards();
        this.renderSidebar();
    }

    async handlePDFUpload(event) {
        const file = event.target.files[0];
        if (!file || file.type !== 'application/pdf') return;

        this.showLoading();

        const id = 'b_' + Date.now();
        const newBoard = {
            id: id,
            name: file.name,
            lastModified: Date.now(),
            favorite: false,
            deleted: false,
            objectCount: 0,
            preview: null,
            folderId: this.currentView.startsWith('f_') ? this.currentView : null,
            coverBg: '#fa5252',
            coverTexture: 'dots',
            isPDF: true,
            alwaysSaveAsPDF: true
        };

        try {
            // Save to IndexedDB
            await Utils.db.save(id, file);

            // Update cache as well
            if (this._pdfInDbCache) this._pdfInDbCache.add(id);

            this.boards.push(newBoard);
            await this.saveDataAsync('wb_boards', this.boards);

            // Sync metadata'yı güncelle (Drive PUSH'u tetiklemek için)
            await window.fileSystemManager.updateSyncMetadata(id);

            this.renderBoards();
            this.renderSidebar();

            // Optionally open immediately if you want, but per user request we stay on dashboard
            // this.loadBoard(id);

            // Clear input
            event.target.value = '';
        } catch (error) {
            console.error('Error saving PDF to IndexedDB:', error);
            Utils.showToast(window.i18n.t('pdf_save_error_msg'), 'error');
        } finally {
            this.hideLoading();
        }
    }

    async loadBoard(id, templateId = null) {
        const board = this.boards.find(b => b.id === id);
        if (!board) return;

        // Track the last opened board so showDashboard() can save it in the background
        // even after currentBoardId has been set to null.
        this._lastOpenedBoardId = id;

        this.showLoading();

        // Transition UI
        this.container.style.display = 'none';
        this.appContainer.style.display = 'flex';

        // Close sidebar on mobile
        if (window.innerWidth <= 768) {
            const sidebar = document.querySelector('.dashboard-sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            this.sidebarCollapsed = true;
            sidebar?.classList.add('collapsed');
            overlay?.classList.remove('show');
        }

        // Force resize to calculate dimensions now that app is visible
        window.dispatchEvent(new Event('resize'));

        // Use TabManager to open this board as a tab
        if (this.app.tabManager) {
            await this.app.tabManager.openBoard(id, board.name, templateId);
        } else {
            // Fallback to old behavior if TabManager not available
            this.currentBoardId = id;
            await this.loadBoardContent(id, templateId);
        }

        // Fit to width by default 
        if (this.app.zoomManager) {
            setTimeout(() => {
                this.app.zoomManager.fitToWidth(10, true);
                this.hideLoading();
            }, 100);
            this.hideLoading();
        }
    }

    async loadBoardContent(id, templateId = null) {
        console.log(`[Dashboard] Loading content for board: ${id}`);
        this._pdfBase64Cache.delete(id); // Clear specific cache for this board to ensure fresh state

        // Reset state
        if (this.app.pageManager) this.app.pageManager.clear();
        this.app.state.objects = [];

        // Clear previous PDF if any
        if (this.app.pdfManager) this.app.pdfManager.clearPDF();

        // Check if there is an associated PDF in IndexedDB
        let pdfLoaded = false;
        try {
            let pdfBlob = await Utils.db.get(id);
            
            // Fallback: If not in DB, try loading from native file system
            if (!pdfBlob && window.fileSystemManager.mode === 'native' && this.app.pdfManager) {
                const board = this.boards.find(b => b.id === id);
                if (board && board.isPDF) {
                    console.log('[Dashboard] PDF not in DB, attempting native load...');
                    pdfBlob = await window.fileSystemManager._loadPDFFromNative(id);
                    if (pdfBlob) {
                        await Utils.db.save(id, pdfBlob);
                        console.log('[Dashboard] Native PDF successfully recovered and saved to DB.');
                    }
                }
            }

            // Fallback 2: Try pulling from Google Drive if available
            if (!pdfBlob && getCloud().gdriveToken && this.app.pdfManager) {
                const board = this.boards.find(b => b.id === id);
                if (board && board.isPDF) {
                    console.log('[Dashboard] PDF not found locally, attempting Drive download...');
                    const success = await getCloud()._downloadPdfBackground(board);
                    if (success) {
                        pdfBlob = await Utils.db.get(id);
                        console.log('[Dashboard] PDF successfully recovered from Google Drive.');
                    }
                }
            }

            if (pdfBlob && this.app.pdfManager) {
                if (pdfBlob.size === 0) {
                    console.warn('[Dashboard] PDF blob is empty (0 bytes)!');
                    throw new Error(window.i18n.t('pdf_empty_error'));
                }
                console.log(`[Dashboard] PDF source found (${pdfBlob.size} bytes), loading...`);
                const pdfUrl = URL.createObjectURL(pdfBlob);
                const success = await this.app.pdfManager.loadPDF(pdfUrl);
                if (!success) throw new Error(window.i18n.t('pdf_load_error'));
                pdfLoaded = true;
            }
        } catch (error) {
            console.error('Error loading PDF:', error);
        }

        const savedData = await this.loadDataAsync(`wb_content_${id}`, null);
        if (savedData) {
            // Extraction of embedded PDF data if it wasn't in IndexedDB already
            if (!pdfLoaded && savedData.pdfBase64 && this.app.pdfManager && this.app.ncilFileManager) {
                try {
                    console.log('[Dashboard] Found embedded PDF in .ncil file, extracting and saving to DB...');
                    const pdfBlob = await this.app.ncilFileManager._base64ToBlob(savedData.pdfBase64, 'application/pdf');
                    await Utils.db.save(id, pdfBlob);
                    const pdfUrl = URL.createObjectURL(pdfBlob);
                    await this.app.pdfManager.loadPDF(pdfUrl);
                    console.log('[Dashboard] Embedded PDF successfully loaded.');
                    pdfLoaded = true;

                    // Update board meta to show PDF icon in future
                    const board = this.boards.find(b => b.id === id);
                    if (board && !board.isPDF) {
                        board.isPDF = true;
                        board.isNcilFile = true;
                        await this.saveDataAsync('wb_boards', this.boards);
                    }
                } catch (err) {
                    console.warn('[Dashboard] Error extracting embedded PDF:', err);
                }
            }

            let pages = savedData.pages;
            const objects = savedData.objects;

            const ncilFM = this.app.ncilFileManager;
            const deserializeObj = ncilFM
                ? (obj) => ncilFM._deserializeObject(obj)
                : (obj) => Promise.resolve(obj);

            if (pdfLoaded && (!pages || pages.length === 0)) {
                console.log('[Dashboard] PDF loaded but no pages in savedData, initializing pages from PDF...');
                // PDFManager loadPDF calls pageManager.pages = newPages automatically
                // but we need to ensure the first page is active
                if (this.app.pageManager) {
                    this.app.pageManager.switchPage(0, true, false);
                }
            } else if (pages) {
                console.log(`[Dashboard] ${pages.length} pages found in save file.`);
                pages = await Promise.all(pages.map(async page => {
                    page.objects = await Promise.all((page.objects || []).map(obj => deserializeObj(obj)));
                    return page;
                }));
                if (this.app.pageManager) {
                    this.app.pageManager.pages = pages;
                    this.app.pageManager.renderPageList();
                    
                    // Son kalınan sayfayı geri yükle (Eğer ayar açıksa)
                    const lastPageIndex = (this.viewSettings.rememberLastPage !== false && savedData.currentPageIndex !== undefined) 
                        ? savedData.currentPageIndex 
                        : 0;
                    this.app.pageManager.switchPage(lastPageIndex, true, false);
                    
                    this.app.pageManager.refreshAllThumbnails();
                }
            } else if (objects) {
                console.log(`[Dashboard] Legacy objects found in save file.`);
                const deserializedObjects = await Promise.all((objects || []).map(obj => deserializeObj(obj)));
                this.app.state.objects = deserializedObjects;
                if (this.app.pageManager) {
                    if (pdfLoaded) {
                        // For PDF legacy saves, we don't want to replace pages, just objects on first page
                        this.app.pageManager.switchPage(0, true, false);
                    } else {
                        this.app.pageManager.pages = [{
                            id: Date.now(),
                            name: 'Sayfa 1',
                            objects: Utils.deepClone(this.app.state.objects),
                            backgroundColor: 'white',
                            backgroundPattern: 'none',
                            thumbnail: null
                        }];
                        this.app.pageManager.currentPageIndex = 0;
                        this.app.pageManager.renderPageList();
                        this.app.pageManager.updateCurrentPageThumbnail(true);
                    }
                }
            } else if (pdfLoaded) {
                // If PDF loaded but no objects or pages in savedData
                console.log('[Dashboard] PDF loaded but no saved data, ensuring first page is active.');
                if (this.app.pageManager) {
                    this.app.pageManager.switchPage(0, true, false);
                }
            }
        } else {
            console.log('[Dashboard] No saved content found, creating fresh board.');
            // Fresh board
            if (this.app.pageManager) {
                const isPdf = this.app.pdfManager && this.app.pdfManager.isLoaded;
                if (!isPdf) {
                    this.app.pageManager.pages = [{
                        id: Date.now(),
                        name: 'Sayfa 1',
                        objects: [],
                        backgroundColor: 'white',
                        backgroundPattern: 'none',
                        thumbnail: null
                    }];
                    this.app.pageManager.currentPageIndex = 0;
                    this.app.pageManager.renderPageList();
                    this.app.pageManager.switchPage(0, true, false);
                } else {
                    // If PDF is loaded but no saved content, ensure we are on page 1
                    console.log('[Dashboard] PDF board, ensuring first page active.');
                    this.app.pageManager.switchPage(0, true, false);
                }
            }

            // APPLY TEMPLATE ATOMICALLY IF REQUESTED
            if (templateId && this.app.templateManager) {
                console.log(`[Dashboard] Applying template ${templateId} to new board.`);
                await this.app.templateManager.applyTemplate(templateId);
            }
        }

        this.app.redrawOffscreen();
        this.app.render();
    }

    async saveCurrentBoard(force = false, skipHeavy = false, boardIdToSave = null) {
        const boardId = boardIdToSave || this.currentBoardId;
        if (!boardId) return;

        // Clear existing timeout if it exists
        if (this._saveTimeout) {
            clearTimeout(this._saveTimeout);
            this._saveTimeout = null;
        }

        const runSave = async () => {
            // 0. Skip autosave if the user is actively drawing
            if (!force && this.app.tools[this.app.state.currentTool]?.isDrawing) {
                this.saveCurrentBoard(false);
                return;
            }

            // 1. Sync current page state (skip clone if we serialize immediately)
            if (this.app.pageManager) {
                // Skip thumbnail generation during fast switch
                this.app.pageManager.saveCurrentPageState(force && !skipHeavy, !force); 
            }

            // 2. Prepare board meta (Snapshot for async save)
            const boardIndex = this.boards.findIndex(b => b.id === boardId);
            let boardMetaToSave = null;
            if (boardIndex !== -1) {
                const board = this.boards[boardIndex];
                const now = Date.now();

                const shouldUpdatePreview = !skipHeavy && (force || !board._lastPreviewTime || (now - board._lastPreviewTime > 60000));
                if (shouldUpdatePreview) {
                    // FIX: canvas.toDataURL() is synchronous and blocks the main thread.
                    // Defer it to an idle callback so it doesn't freeze the UI during navigation.
                    const capturePreview = () => {
                        try {
                            board.preview = this.app.canvas.toDataURL('image/webp', 0.4);
                            board._lastPreviewTime = Date.now();
                        } catch (error) { console.warn('Preview error:', error); }
                    };
                    if (window.requestIdleCallback) {
                        requestIdleCallback(capturePreview, { timeout: 3000 });
                    } else {
                        setTimeout(capturePreview, 0);
                    }
                }

                board.lastModified = now;
                board.objectCount = (this.app.state.objects || []).length;

                const shouldSaveMeta = force || !board._lastMetaSaveTime || (now - board._lastMetaSaveTime > 30000);
                if (shouldSaveMeta) {
                    board._lastMetaSaveTime = now;
                    boardMetaToSave = [...this.boards];
                }
            }

            // 3. Serializer definition
            const ncilFM = this.app.ncilFileManager;
            const serializeObj = (obj) => {
                if (!obj) return null;
                let o;
                if (ncilFM) {
                    o = ncilFM._serializeObject(obj);
                } else {
                    o = Object.assign({}, obj);
                    if (o.x !== undefined) o.x = Math.round(o.x * 100000) / 100000;
                    if (o.y !== undefined) o.y = Math.round(o.y * 100000) / 100000;
                    if (o.width !== undefined) o.width = Math.round(o.width * 100000) / 100000;
                    if (o.height !== undefined) o.height = Math.round(o.height * 100000) / 100000;
                    if (o.points && Array.isArray(o.points) && !o._flat) {
                        const flat = new Float32Array(o.points.length * 3);
                        for (let i = 0; i < o.points.length; i++) {
                            const p = o.points[i];
                            flat[i * 3] = p.x;
                            flat[i * 3 + 1] = p.y;
                            flat[i * 3 + 2] = p.pressure !== undefined ? p.pressure : 0.5;
                        }
                        o.points = Array.from(flat);
                        o._flat = true;
                    }
                }
                for (const key in o) {
                    const val = o[key];
                    if (val === undefined || typeof val === 'function' || val instanceof Node) {
                        delete o[key];
                    } else if (key.startsWith('_') && key !== '_flat') {
                        delete o[key];
                    }
                }
                return o;
            };

            // 4. Serialize EVERYTHING synchronously to avoid inconsistency during awaits
            const optimizedPages = this.app.pageManager ? this.app.pageManager.pages.map((page, idx) => {
                const optimizedPage = Object.assign({}, page);
                delete optimizedPage.thumbnail;
                const sourceObjects = (idx === this.app.pageManager.currentPageIndex) 
                    ? this.app.state.objects 
                    : (page.objects || []);
                optimizedPage.objects = sourceObjects.map(obj => serializeObj(obj));
                return optimizedPage;
            }) : null;

            // 5. Async Operations
            if (boardMetaToSave) {
                // Eğer bu bir ham PDF ise ve üzerine bir şeyler yazılmışsa (objects veya sayfa eklenmişse)
                // artık ham kaynak değildir, Drive'da sidecar (.ncil) oluşturulması gerekir.
                const b = boardMetaToSave.find(x => x.id === boardId);
                
                // GÜVENLİK: Eğer yerel klasör bağlantısı kesildiyse ve objects/pages boş görünüyorsa, 
                // isRawSource'u yanlışlıkla false yapmamalıyız. 
                // Sadece AKTİF olarak bir şey eklenmişse false yapmalıyız.
                const hasActiveContent = (optimizedPages && optimizedPages.length > 0) || (content.objects && content.objects.length > 0);
                
                if (b && b.isRawSource && hasActiveContent) {
                    b.isRawSource = false;
                    console.log(`[Dashboard] ${b.name} artık ham kaynak değil (notlar eklendi).`);
                }
                await this.saveDataAsync('wb_boards', boardMetaToSave);
            }

            // PDF base64 handling:
            // CRITICAL: We only include pdfBase64 if it's NOT already in the main DB 
            // OR if it's the very first save of a newly imported Ncil file.
            // For regular autosaves, including 10MB+ of base64 in the JSON content
            // is the main cause of stuttering on PDF boards.
            let pdfBase64 = null;
            // FIX: Cache whether the PDF blob exists in DB instead of reading the full blob
            // every save cycle. Reading a 5-20MB blob from IndexedDB on every autosave
            // is a major source of lag on PDF boards.
            if (!this._pdfInDbCache) this._pdfInDbCache = new Set();
            let pdfSourceInDB = this._pdfInDbCache.has(boardId);
            if (!pdfSourceInDB) {
                // Only do the expensive DB read once to populate the cache
                const blobCheck = await Utils.db.get(boardId);
                if (blobCheck) {
                    this._pdfInDbCache.add(boardId);
                    pdfSourceInDB = true;
                }
            }

            if (!pdfSourceInDB) {
                pdfBase64 = this._pdfBase64Cache.get(boardId) || null;
                if (!pdfBase64 && this.app.pdfManager && this.app.pdfManager.isLoaded) {
                    try {
                        const pdfBlob = await Utils.db.get(boardId);
                        if (pdfBlob instanceof Blob) {
                            pdfBase64 = await this.app.ncilFileManager._blobToBase64(pdfBlob);
                            this._pdfBase64Cache.set(boardId, pdfBase64);
                            this._pdfInDbCache.add(boardId); // Mark as in DB for future saves
                        }
                    } catch (e) { console.warn('PDF fetch error:', e); }
                }
            }

            const content = {
                version: "2.1",
                pages: optimizedPages,
                currentPageIndex: this.app.pageManager ? this.app.pageManager.currentPageIndex : 0,
                objects: optimizedPages ? null : (this.app.state.objects || []).map(obj => serializeObj(obj)),
                pdfBase64: pdfBase64 // Will be null for regular autosaves if PDF is already in DB
            };

            await this.saveDataAsync(`wb_content_${boardId}`, content);

            // 6. Background PDF save for native mode
            const board = this.boards.find(b => b.id === boardId);
            if (force && board && board.alwaysSaveAsPDF && window.fileSystemManager.dirHandle) {
                setTimeout(async () => {
                    try {
                        let pdfBlob;
                        if (this.app.pdfManager && this.app.pdfManager.isLoaded) {
                            const originalPdfBlob = await Utils.db.get(boardId);
                            if (originalPdfBlob) {
                                const saver = new PDFIncrementalSave(this.app);
                                const pdfBytes = await saver.export(originalPdfBlob);
                                pdfBlob = new Blob([pdfBytes], { type: 'application/pdf' });
                            } else {
                                console.warn('[Dashboard] Original PDF blob missing from DB, skipping background save to prevent data loss.');
                            }
                        } else if (!board.isPDF) {
                            // Only use generatePDFBlob for NON-PDF boards (regular drawings that user wants to keep as PDF)
                            // For PDF boards, if pdfManager.isLoaded is false, we should NOT overwrite the original PDF.
                            pdfBlob = await this.app.exportManager.generatePDFBlob();
                        } else {
                            console.warn('[Dashboard] PDF board not loaded yet, skipping background PDF save to avoid data loss.');
                        }
                        
                        if (pdfBlob) await window.fileSystemManager._savePDFToNative(boardId, pdfBlob);
                    } catch (err) { console.error('Background PDF save error:', err); }
                }, 500);
            }
        };

        if (force) {
            return await runSave();
        } else {
            const interval = this.viewSettings.autosaveInterval || 'off';
            
            // If autosave is off, don't schedule a periodic save
            if (interval === 'off') {
                return;
            }

            return new Promise((resolve) => {
                this._saveTimeout = setTimeout(async () => {
                    // Use requestIdleCallback if available to not block drawing
                    if (window.requestIdleCallback) {
                        window.requestIdleCallback(async (deadline) => {
                            if (deadline.timeRemaining() > 10 || deadline.didTimeout) {
                                await runSave();
                                resolve();
                            } else {
                                // Defer again if busy
                                this.saveCurrentBoard(false).then(resolve);
                            }
                        }, { timeout: 2000 });
                    } else {
                        await runSave();
                        resolve();
                    }
                }, parseInt(interval)); // Use the selected interval
            });
        }
    }

    setupAutosaveFlush() {
        // Tab kapandığında veya arka plana atıldığında bekleyen kaydı anında yap
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden' && this.currentBoardId) {
                console.log('[Autosave] Visibility hidden, flushing save...');
                this.saveCurrentBoard(true);
            }
        });

        // Sayfa tamamen kapatılmadan önce (opsiyonel ama güvenli)
        window.addEventListener('beforeunload', () => {
            if (this.currentBoardId) {
                this.saveCurrentBoard(true);
            }
        });
    }

    async showDashboard() {
        // FIX: Show the dashboard UI immediately instead of waiting for the save to complete.
        // Previously, `await saveCurrentBoard(true)` blocked the UI switch, causing a visible
        // freeze. Now we switch the view first, then save in the background.
        this.currentBoardId = null;
        this.container.style.display = 'flex';
        this.appContainer.style.display = 'none';

        // Auto-collapse on mobile when showing dashboard
        if (window.innerWidth <= 768) {
            const sidebar = document.querySelector('.dashboard-sidebar');
            const overlay = document.getElementById('sidebarOverlay');
            this.sidebarCollapsed = true;
            sidebar?.classList.add('collapsed');
            overlay?.classList.remove('show');
        }

        // Render immediately with cached board data so the grid appears right away
        if (this.currentView === 'calendar' && window.calendar) {
            window.calendar.show();
        } else {
            this.renderSidebar();
            this.renderBoards();
        }

        // Run save + data refresh in the background after UI is visible
        const prevBoardId = this._lastOpenedBoardId;
        this._lastOpenedBoardId = null;
        Promise.resolve().then(async () => {
            try {
                // Temporarily restore boardId for the save call
                this.currentBoardId = prevBoardId;
                await this.saveCurrentBoard(true);
            } catch (error) {
                console.error('[Dashboard] Background save failed:', error);
            } finally {
                this.currentBoardId = null;
                this._pdfBase64Cache.clear();
                // Also clear the PDF-in-DB cache when leaving a board
                if (this._pdfInDbCache && prevBoardId) {
                    // Keep the cache entry — it's still valid for next open
                }
            }

            // Refresh board list from storage after save (picks up lastModified etc.)
            this.boards = await this.loadDataAsync('wb_boards', []);
            this.folders = await this.loadDataAsync('wb_folders', []);
            this.renderSidebar();
            this.renderBoards();
        });
    }

    async deleteBoard(id) {
        const board = this.boards.find(b => b.id === id);
        if (board) {
            if (board.deleted) {
                // Hard delete — IndexedDB + native klasör
                this.boards = this.boards.filter(b => b.id !== id);
                // FileSystemManager üzerinden sil (native klasörü de temizler)
                await window.fileSystemManager.removeItem(`wb_content_${id}`);

                // Remove PDF from IndexedDB if applicable and clear cache
                if (board.isPDF) {
                    if (this._pdfInDbCache) this._pdfInDbCache.delete(id);
                    Utils.db.delete(id).catch(err => console.error('PDF silme hatası:', err));
                }

                // Senkronizasyon için silindiğini işaretle
                const deletedIds = await this.loadDataAsync('wb_deleted_ids', []);
                if (!deletedIds.includes(id)) {
                    deletedIds.push(id);
                    await this.saveDataAsync('wb_deleted_ids', deletedIds);
                    // Drive'dan anında sil (trash'e at)
                    this._syncDeletionToDrive([id]);
                }
            } else {
                // Soft delete (çöp kutusuna taşı)
                board.deleted = true;
            }

            await this.saveDataAsync('wb_boards', this.boards);

            // Remove from TabManager if open
            if (this.app.tabManager) {
                this.app.tabManager.closeTab(id);
            }

            this.renderBoards();
        }
    }

    async emptyTrash() {
        const trashedBoards = this.boards.filter(b => b.deleted);
        if (trashedBoards.length === 0) return;

        const confirmed = await Utils.showConfirm({
            title: 'Çöp Kutusunu Boşalt',
            message: `Çöp kutusundaki ${trashedBoards.length} öğeyi kalıcı olarak silmek istediğinize emin misiniz?`,
            confirmText: 'Kalıcı Sil',
            type: 'danger'
        });

        if (confirmed) {
            // FileSystemManager üzerinden sil (IndexedDB + native klasör)
            await Promise.all(trashedBoards.map(async b => {
                await window.fileSystemManager.removeItem(`wb_content_${b.id}`);
                if (b.isPDF) {
                    if (this._pdfInDbCache) this._pdfInDbCache.delete(b.id);
                    Utils.db.delete(b.id).catch(err => console.error('PDF silme hatası:', err));
                }
            }));

            const idsToRemove = trashedBoards.map(b => b.id);
            this.boards = this.boards.filter(b => !b.deleted);
            await this.saveDataAsync('wb_boards', this.boards);

            // Drive'dan anında sil (trash'e at)
            this._syncDeletionToDrive(idsToRemove);

            // Senkronizasyon için silindiğini işaretle
            const deletedIds = await this.loadDataAsync('wb_deleted_ids', []);
            let changed = false;
            idsToRemove.forEach(id => {
                if (!deletedIds.includes(id)) {
                    deletedIds.push(id);
                    changed = true;
                }
            });
            if (changed) await this.saveDataAsync('wb_deleted_ids', deletedIds);

            if (this.app.tabManager) {
                idsToRemove.forEach(id => this.app.tabManager.closeTab(id));
            }

            this.renderBoards();
        }
    }

    async toggleFavorite(id) {
        const board = this.boards.find(b => b.id === id);
        if (board) {
            board.favorite = !board.favorite;
            await this.saveDataAsync('wb_boards', this.boards);
            this.renderBoards();
        }
    }

    async renameBoard(id, newName) {
        const board = this.boards.find(b => b.id === id);
        if (board && newName.trim()) {
            // Eski yolu kaydet (taşıma için)
            const oldBoard = { ...board };
            board.name = newName.trim();
            board.lastModified = Date.now();
            await this.saveDataAsync('wb_boards', this.boards);

            // Sync metadata'yı güncelle (Drive PUSH'u tetiklemek için)
            await window.fileSystemManager.updateSyncMetadata(id);

            // Native klasörde dosyayı yeni isme taşı
            await window.fileSystemManager.moveBoardNativeFile(id, oldBoard);
            // Yeni konuma kaydet
            if (window.fileSystemManager.mode === 'native') {
                const content = await window.fileSystemManager.getItem(`wb_content_${id}`, null);
                if (content) await window.fileSystemManager._saveBoardToNative(`wb_content_${id}`, content);
            }

            if (this.app.tabManager) {
                this.app.tabManager.updateTabTitle(id, newName.trim());
            }

            // Sync trigger
            if (window.fileSystemManager.onSave) window.fileSystemManager.onSave();
        }
    }

    async moveBoardToFolder(boardId, folderId) {
        const board = this.boards.find(b => b.id === boardId);
        if (board) {
            const oldBoard = { ...board };
            board.folderId = folderId || null;
            board.lastModified = Date.now();
            await this.saveDataAsync('wb_boards', this.boards);

            // Sync metadata'yı güncelle (Drive PUSH'u tetiklemek için)
            await window.fileSystemManager.updateSyncMetadata(boardId);

            // Native klasörde dosyayı yeni konuma taşı
            await window.fileSystemManager.moveBoardNativeFile(boardId, oldBoard);
            if (window.fileSystemManager.mode === 'native') {
                const content = await window.fileSystemManager.getItem(`wb_content_${boardId}`, null);
                if (content) await window.fileSystemManager._saveBoardToNative(`wb_content_${boardId}`, content);
            }

            this.renderBoards();
            if (window.fileSystemManager.onSave) window.fileSystemManager.onSave();
        }
    }

    async updateBoardShape(boardId, shape) {
        const board = this.boards.find(b => b.id === boardId);
        if (board) {
            board.shape = shape;
            await this.saveDataAsync('wb_boards', this.boards);
            this.renderBoards();
        }
    }

    setupAppNavigation() {
        const logo = document.getElementById('btnHome');
        if (logo) {
            logo.style.pointerEvents = 'auto'; // Force enable
            logo.onclick = async () => await this.showDashboard();
        }

        const handleSave = () => {
            this.saveCurrentBoard();
            Utils.showToast('Beyaz tahta kaydedildi!', 'success');
            const dropdown = document.getElementById('appMenuDropdown');
            if (dropdown) dropdown.classList.remove('show');
        };

        const saveBtn = document.getElementById('saveBtn');
        if (saveBtn) saveBtn.onclick = handleSave;

        const menuSave = document.getElementById('menuSave');
        if (menuSave) menuSave.onclick = handleSave;
    }



    setupViewOptions() {
        const dropdown = document.getElementById('viewOptionsDropdown');

        if (dropdown) {
            // Remember last page toggle
             const checkRememberLastPage = document.getElementById('checkRememberLastPage');
             if (checkRememberLastPage) {
                 checkRememberLastPage.checked = this.viewSettings.rememberLastPage !== false;
                 checkRememberLastPage.onchange = () => {
                     this.viewSettings.rememberLastPage = checkRememberLastPage.checked;
                     this.saveData('wb_view_settings', this.viewSettings);
                 };
             }

            // Size buttons
            dropdown.querySelectorAll('.size-btn').forEach(btn => {
                btn.onclick = () => {
                    this.viewSettings.gridSize = btn.dataset.size;
                    this.saveData('wb_view_settings', this.viewSettings);
                    this.applyViewSettings();

                    dropdown.querySelectorAll('.size-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                };

                if (btn.dataset.size === this.viewSettings.gridSize) {
                    btn.classList.add('active');
                }
            });

            // Icon color picker
            const iconColorPicker = document.getElementById('uiIconColorPicker');
            const btnApplyIconColor = document.getElementById('btnApplyIconColor');
            const btnResetIconColor = document.getElementById('btnResetIconColor');

            if (iconColorPicker) {
                // Initialize from settings
                if (this.viewSettings.iconColor) {
                    iconColorPicker.value = this.viewSettings.iconColor;
                    document.documentElement.style.setProperty('--app-icon-color', this.viewSettings.iconColor);
                }
            }

            if (btnApplyIconColor && iconColorPicker) {
                btnApplyIconColor.onclick = () => {
                    const color = iconColorPicker.value;
                    this.viewSettings.iconColor = color;
                    
                    // Sync with settings modal picker
                    const settingsPicker = document.getElementById('settingsIconColorPicker');
                    if (settingsPicker) settingsPicker.value = color;

                    this.saveData('wb_view_settings', this.viewSettings);
                    document.documentElement.style.setProperty('--app-icon-color', color);
                };
            }

            if (btnResetIconColor) {
                btnResetIconColor.onclick = () => {
                    const defaultColor = '#616161';
                    if (iconColorPicker) iconColorPicker.value = defaultColor;
                    this.viewSettings.iconColor = defaultColor;

                    // Sync with settings modal picker
                    const settingsPicker = document.getElementById('settingsIconColorPicker');
                    if (settingsPicker) settingsPicker.value = defaultColor;

                    this.saveData('wb_view_settings', this.viewSettings);
                    document.documentElement.style.setProperty('--app-icon-color', defaultColor);
                };
            }

            // Close dropdown when clicking outside
            document.addEventListener('click', (e) => {
                const isTrigger = e.target.closest('#btnSidebarViewOptions');
                if (!isTrigger && !e.target.closest('.view-options-dropdown')) {
                    dropdown.classList.remove('show');
                }
            });
        }
    }

    setupSearch() {
        const handleSearch = (e) => {
            this.searchTerm = e.target.value.toLowerCase().trim();
            const hasTerm = this.searchTerm.length > 0;
            if (this.searchClearBtn) this.searchClearBtn.style.display = hasTerm ? 'block' : 'none';
            if (this.mobileSearchClearBtn) this.mobileSearchClearBtn.style.display = hasTerm ? 'block' : 'none';
            this.renderBoards();
        };

        if (this.searchInput) this.searchInput.oninput = handleSearch;
        if (this.mobileSearchInput) this.mobileSearchInput.oninput = handleSearch;

        if (this.searchClearBtn) this.searchClearBtn.onclick = () => this.clearSearch();
        if (this.mobileSearchClearBtn) this.mobileSearchClearBtn.onclick = () => this.clearSearch();
    }

    clearSearch() {
        this.searchTerm = '';
        if (this.searchInput) this.searchInput.value = '';
        if (this.mobileSearchInput) this.mobileSearchInput.value = '';
        if (this.searchClearBtn) this.searchClearBtn.style.display = 'none';
        if (this.mobileSearchClearBtn) this.mobileSearchClearBtn.style.display = 'none';
        this.renderBoards();
    }

    applyViewSettings() {
        if (!this.boardGrid) return;

        // Reset classes
        this.boardGrid.classList.remove('size-mini', 'size-xsmall', 'size-small', 'size-medium', 'size-large');

        // Apply new classes
        this.boardGrid.classList.add(`size-${this.viewSettings.gridSize}`);
    }

    setupCoverModal() {
        const modal = document.getElementById('coverModal');
        const grid = document.getElementById('coverGrid');
        const closeBtn = document.getElementById('btnCloseCoverModal');
        const addBtn = document.getElementById('btnAddCustomCover');
        const colorInput = document.getElementById('customCoverColor');
        const uploadBtn = document.getElementById('btnUploadCoverImage');
        const fileInput = document.getElementById('customCoverImage');

        if (!modal || !grid || !addBtn || !colorInput) return;
 
        const paperTextureSelect = document.getElementById('coverPaperTexture');
        const metallicDetailSelect = document.getElementById('coverMetallicDetail');
        const labelStyleSelect = document.getElementById('coverLabelStyle');
        const showFolderIconCheck = document.getElementById('showFolderIconOnCover');

        [paperTextureSelect, metallicDetailSelect, labelStyleSelect, showFolderIconCheck].forEach(el => {
            if (el) el.onchange = () => this.renderCoverGrid(this.activeBoardForCover);
        });

        if (closeBtn) closeBtn.onclick = () => modal.classList.remove('show');
        modal.onclick = (e) => { if (e.target === modal) modal.classList.remove('show'); };

        addBtn.onclick = async () => {
            try {
                const color = colorInput.value;
                if (!color) return;

                const paperTexture = document.getElementById('coverPaperTexture')?.value || 'none';
                const metallicDetail = document.getElementById('coverMetallicDetail')?.value || 'none';
                const labelStyle = document.getElementById('coverLabelStyle')?.value || 'none';
                const showFolderIcon = document.getElementById('showFolderIconOnCover')?.checked || false;

                const newCover = { id: 'custom_' + Date.now(), bg: color, paperTexture, metallicDetail, labelStyle, showFolderIcon };
                this.customCovers = Array.isArray(this.customCovers) ? this.customCovers : [];
                this.customCovers.unshift(newCover);
                this.saveData('wb_custom_covers', this.customCovers);

                if (this.activeBoardForCover) {
                    const board = (this.boards || []).find(b => b.id === this.activeBoardForCover);
                    if (board) {
                        board.coverBg = color;
                        board.paperTexture = paperTexture;
                        board.metallicDetail = metallicDetail;
                        board.labelStyle = labelStyle;
                        board.showFolderIcon = showFolderIcon;
                        delete board.coverImage; // Remove image if color selected
                        await this.saveDataAsync('wb_boards', this.boards);
                        this.renderBoards();
                    }
                } else if (this.selectedBoards && this.selectedBoards.size > 0) {
                    // Bulk mode custom color apply
                    this.selectedBoards.forEach(selId => {
                        const board = (this.boards || []).find(b => b.id === selId);
                        if (board) {
                            board.coverBg = color;
                            board.paperTexture = paperTexture;
                            board.metallicDetail = metallicDetail;
                            board.labelStyle = labelStyle;
                            board.showFolderIcon = showFolderIcon;
                            delete board.coverImage;
                        }
                    });
                    await this.saveDataAsync('wb_boards', this.boards);
                    this.renderBoards();
                    this.clearSelection();
                }
                modal.classList.remove('show');
            } catch (err) {
                console.error('Error in addBtn click handler:', err);
                modal.classList.remove('show');
            }

        };

        if (uploadBtn && fileInput) {
            uploadBtn.onclick = () => fileInput.click();
            fileInput.onchange = (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.onload = (re) => {
                    const dataUrl = re.target.result;

                    // Compress image before saving
                    this.compressImage(dataUrl, (compressedUrl) => {
                        const newCover = { id: 'img_' + Date.now(), bg: '#ffffff', image: compressedUrl };
                        this.customCovers = Array.isArray(this.customCovers) ? this.customCovers : [];
                        this.customCovers.unshift(newCover);
                        this.saveData('wb_custom_covers', this.customCovers);

                        if (this.activeBoardForCover) {
                            const board = (this.boards || []).find(b => b.id === this.activeBoardForCover);
                            if (board) {
                                board.coverBg = '#ffffff';
                                board.coverImage = compressedUrl;
                                this.saveData('wb_boards', this.boards);
                                this.renderBoards();
                            }
                        } else if (this.selectedBoards && this.selectedBoards.size > 0) {
                            // Bulk mode custom image apply
                            this.selectedBoards.forEach(selId => {
                                const board = (this.boards || []).find(b => b.id === selId);
                                if (board) {
                                    board.coverBg = '#ffffff';
                                    board.coverImage = compressedUrl;
                                }
                            });
                            this.saveData('wb_boards', this.boards);
                            this.renderBoards();
                            this.clearSelection();
                        }
                        modal.classList.remove('show');
                        fileInput.value = ''; // Reset
                    });
                };

                reader.readAsDataURL(file);
            };
        }
    }

    compressImage(dataUrl, callback) {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const maxDimension = 400;

            if (width > height) {
                if (width > maxDimension) {
                    height *= maxDimension / width;
                    width = maxDimension;
                }
            } else {
                if (height > maxDimension) {
                    width *= maxDimension / height;
                    height = maxDimension;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Use JPEG with 0.7 quality to save substantial space
            callback(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.src = dataUrl;
    }

    openCoverPicker(boardId) {
        this.activeBoardForCover = boardId;
        const modal = document.getElementById('coverModal');

        if (modal) {
            // Set initial values from current board if not bulk
            if (boardId) {
                const board = (this.boards || []).find(b => b.id == boardId);
                const paperTex = (board && board.paperTexture) || (board && board.coverTexture) || 'none';
                const metalDetail = (board && board.metallicDetail) || 'none';
                const labelStyle = (board && board.labelStyle) || 'none';
                const showFolderIcon = (board && board.showFolderIcon) || false;

                const paperSelect = document.getElementById('coverPaperTexture');
                if (paperSelect) paperSelect.value = paperTex;

                const metalSelect = document.getElementById('coverMetallicDetail');
                if (metalSelect) metalSelect.value = metalDetail;

                const labelSelect = document.getElementById('coverLabelStyle');
                if (labelSelect) labelSelect.value = labelStyle;

                const folderCheck = document.getElementById('showFolderIconOnCover');
                if (folderCheck) folderCheck.checked = showFolderIcon;
            } else {
                // Default for bulk
                const paperSelect = document.getElementById('coverPaperTexture');
                if (paperSelect) paperSelect.value = 'none';

                const metalSelect = document.getElementById('coverMetallicDetail');
                if (metalSelect) metalSelect.value = 'none';

                const labelSelect = document.getElementById('coverLabelStyle');
                if (labelSelect) labelSelect.value = 'none';

                const folderCheck = document.getElementById('showFolderIconOnCover');
                if (folderCheck) folderCheck.checked = false;
            }

            modal.classList.add('show');
            this.renderCoverGrid(boardId);
        } else {
            console.error('Notebook cover modal not found');
        }
    }


    renderCoverGrid(boardId) {
        const grid = document.getElementById('coverGrid');
        const isBulk = !boardId;

        let board = null;
        if (!isBulk) {
            // Use == for type safety (string vs number)
            board = (this.boards || []).find(b => b.id == boardId);
            if (!board) return;
        }
        // Note: In bulk mode, we allow rendering even if selectedBoards is empty
        // User might select boards after opening the modal

        if (!grid) return;
        grid.innerHTML = '';

        const allCovers = [
            ...this.defaultCovers.map(c => ({ ...c, isDefault: true })),
            ...this.customCovers.map(c => ({ ...c, isDefault: false }))
        ];

        const paperTexture = document.getElementById('coverPaperTexture')?.value || 'none';
        const metallicDetail = document.getElementById('coverMetallicDetail')?.value || 'none';
        const labelStyle = document.getElementById('coverLabelStyle')?.value || 'none';
        const showFolderIcon = document.getElementById('showFolderIconOnCover')?.checked || false;

        allCovers.forEach(cover => {
            const item = document.createElement('div');
            item.className = 'cover-item';

            const isImage = !!cover.image;
            if (!isImage) {
                if (paperTexture !== 'none') item.classList.add(`cover-texture-${paperTexture}`);
                if (metallicDetail !== 'none') item.classList.add(`cover-detail-${metallicDetail}`);
            }

            if (isImage) {
                item.style.backgroundImage = `url(${cover.image})`;
                item.style.backgroundSize = 'cover';
                item.style.backgroundPosition = 'center';
            } else {
                item.style.backgroundColor = cover.bg;
            }

            // Check active state
            if (!isBulk && board) {
                if (isImage) {
                    if (board.coverImage === cover.image) item.classList.add('active');
                } else {
                    if (board.coverBg === cover.bg && !board.coverImage && 
                        board.coverTexture === selectedTexture &&
                        (board.paperTexture || 'none') === paperTexture &&
                        (board.metallicDetail || 'none') === metallicDetail) {
                        item.classList.add('active');
                    }
                }
            }

            item.innerHTML = '<div class="mini-spine"></div>' +
                (!cover.isDefault ? `<div class="cover-item-delete" title="Sil">×</div>` : '');

            item.onclick = (e) => {
                // If it's a delete click, the handler below will deal with it
                if (e.target.classList.contains('cover-item-delete')) return;

                console.log('Cover clicked:', cover);
                console.log('isBulk:', isBulk);
                console.log('selectedBoards:', this.selectedBoards);

                const applyCoverToBoard = (target) => {
                    console.log('Applying cover to board:', target.id, 'Cover:', cover);
                    if (isImage) {
                        target.coverBg = '#ffffff';
                        target.coverImage = cover.image;
                    } else {
                        target.coverBg = cover.bg;
                        target.coverImage = null;
                    }
                    target.paperTexture = paperTexture;
                    target.metallicDetail = metallicDetail;
                    target.labelStyle = labelStyle;
                    target.showFolderIcon = showFolderIcon;
                    console.log('Board after cover applied:', target);
                };

                if (isBulk) {
                    console.log('Bulk mode - applying to selected boards');
                    this.selectedBoards.forEach(selId => {
                        const targetBoard = this.boards.find(b => b.id == selId);
                        console.log('Found board for ID', selId, ':', targetBoard);
                        if (targetBoard) applyCoverToBoard(targetBoard);
                    });
                } else {
                    console.log('Single mode - applying to board:', board);
                    if (board) applyCoverToBoard(board);
                }

                // CRITICAL: Save BEFORE clearing selection (which triggers render)
                console.log('Saving boards:', this.boards);
                this.saveData('wb_boards', this.boards);

                // Close modal
                document.getElementById('coverModal').classList.remove('show');

                // Clear selection (this will call renderBoards internally)
                if (isBulk) {
                    this.clearSelection();
                } else {
                    this.renderBoards();
                }
            };

            // Set up delete handler
            if (!cover.isDefault) {
                item.querySelector('.cover-item-delete').onclick = (e) => {
                    e.stopPropagation();
                    this.customCovers = this.customCovers.filter(c => c.id !== cover.id);
                    this.saveData('wb_custom_covers', this.customCovers);
                    this.renderCoverGrid(boardId);
                };
            }

            grid.appendChild(item);
        });
    }

    /**
     * Template Gallery Methods
     */
    openTemplateGallery() {
        const modal = document.getElementById('templateGalleryModal');
        if (!modal) return;

        // Ensure templateManager is ready
        if (!this.app.templateManager) {
            console.error('Template manager not initialized');
            return;
        }

        modal.classList.add('show');
        this.renderTemplateGallery();
        this.setupTemplateGalleryHandlers();
    }

    closeTemplateGallery() {
        const modal = document.getElementById('templateGalleryModal');
        if (modal) {
            modal.classList.remove('show');
        }
    }

    setupTemplateGalleryHandlers() {
        // Close button
        const closeBtn = document.getElementById('btnCloseTemplateModal');
        if (closeBtn) {
            closeBtn.onclick = () => this.closeTemplateGallery();
        }

        // Overlay click (modal-backdrop is the overlay)
        const modal = document.getElementById('templateGalleryModal');
        if (modal) {
            modal.onclick = (e) => {
                if (e.target === modal) {
                    this.closeTemplateGallery();
                }
            };
        }

        // Sidebar category filtering
        const sidebarItems = document.querySelectorAll('#templateTabs .settings-sidebar-item');
        sidebarItems.forEach(item => {
            item.onclick = () => {
                // Remove active from all items
                sidebarItems.forEach(i => i.classList.remove('active'));
                // Add active to clicked item
                item.classList.add('active');

                const category = item.dataset.category;
                this.renderTemplateGallery(category);
            };
        });

        // Search
        const searchInput = document.getElementById('templateSearchInput');
        if (searchInput) {
            searchInput.oninput = (e) => {
                const query = e.target.value;
                // If searching, show all categories in "Tümü"
                // But keep the current active tab or switch to "Tümü"? 
                // Usually searching works across all categories.
                this.renderTemplateGallery('Tümü', query);
                
                // If searching, visually highlight "Tümü" tab
                if (query.trim() !== "") {
                    sidebarItems.forEach(i => {
                        if (i.dataset.category === 'Tümü') i.classList.add('active');
                        else i.classList.remove('active');
                    });
                }
            };
        }

        // ESC key to close
        const escHandler = (e) => {
            if (e.key === 'Escape') {
                this.closeTemplateGallery();
                document.removeEventListener('keydown', escHandler);
            }
        };
        document.addEventListener('keydown', escHandler);
    }

    /**
    * Show confirmation dialog
    */
    showConfirmDialog({ title, message, confirmText = 'Onayla', confirmClass = 'btn-danger', onConfirm, onCancel }) {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-dialog-overlay';
        overlay.innerHTML = `
            <div class="confirm-dialog">
                <h3>${title}</h3>
                <p>${message}</p>
                <div class="confirm-dialog-actions">
                    <button class="btn-cancel">İptal</button>
                    <button class="${confirmClass}">${confirmText}</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const dialog = overlay.querySelector('.confirm-dialog');
        const cancelBtn = overlay.querySelector('.btn-cancel');
        const confirmBtn = overlay.querySelector(`.${confirmClass}`);

        cancelBtn.onclick = () => {
            overlay.remove();
            if (onCancel) onCancel();
        };

        confirmBtn.onclick = () => {
            overlay.remove();
            if (onConfirm) onConfirm();
        };

        overlay.onclick = (e) => {
            if (e.target === overlay) {
                overlay.remove();
                if (onCancel) onCancel();
            }
        };
    }

    /**
     * Show undo toast notification
     */
    showUndoToast(message, undoCallback) {
        const toast = document.createElement('div');
        toast.className = 'undo-toast';
        toast.innerHTML = `
            <span>${message}</span>
            <button class="btn-undo">Geri Al</button>
        `;
        document.body.appendChild(toast);

        const undoBtn = toast.querySelector('.btn-undo');
        let undoClicked = false;

        undoBtn.onclick = () => {
            undoClicked = true;
            undoCallback();
            toast.classList.remove('show');
            setTimeout(() => toast.remove(), 300);
        };

        setTimeout(() => toast.classList.add('show'), 10);

        setTimeout(() => {
            if (!undoClicked) {
                toast.classList.remove('show');
                setTimeout(() => toast.remove(), 300);
            }
        }, 5000);
    }

    renderTemplateGallery(category = 'Tümü', searchQuery = '') {
        const grid = document.getElementById('templateGrid');
        if (!grid || !this.app.templateManager) return;

        let templates = [];

        if (searchQuery) {
            templates = this.app.templateManager.searchTemplates(searchQuery);
        } else if (category === 'Favoriler') {
            // Show only favorite templates
            const favoriteIds = this.app.templateManager.favoriteTemplates || [];
            templates = this.app.templateManager.templates.filter(t => favoriteIds.includes(t.id));
        } else if (category && category !== 'Tümü') {
            templates = this.app.templateManager.getTemplatesByCategory(category);
        } else {
            templates = this.app.templateManager.templates;
        }

        grid.innerHTML = '';

        if (templates.length === 0) {
            let emptyMessage, emptyHint, emptyIcon, showButton = false, buttonText = '', buttonAction = null;

            if (category === 'Favoriler') {
                emptyIcon = '⭐';
                emptyMessage = 'Henüz favori şablon eklemediniz';
                emptyHint = 'Şablonları favorilere eklemek için kalp ikonuna tıklayın';
                showButton = true;
                buttonText = 'Tüm Şablonları Gör';
                buttonAction = () => {
                    document.querySelector('[data-category="Tümü"]')?.click();
                };
            } else if (category === 'Kendi Şablonlarım') {
                emptyIcon = '📝';
                emptyMessage = 'Henüz kayıtlı şablonunuz yok';
                emptyHint = 'Bir şablon oluşturmak için:<br>1. İstediğiniz bir notu açın<br>2. Menüden "Şablon Olarak Kaydet" seçin';
                showButton = true;
                buttonText = 'Hazır Şablonlara Göz At';
                buttonAction = () => {
                    document.querySelector('[data-category="Tümü"]')?.click();
                };
            } else if (searchQuery) {
                emptyIcon = '🔍';
                emptyMessage = `"${searchQuery}" ile eşleşen şablon bulunamadı`;
                emptyHint = 'Arama kriterlerinizi değiştirmeyi deneyin';
            } else {
                emptyIcon = '📋';
                emptyMessage = 'Şablon bulunamadı';
                emptyHint = 'Bu kategoride henüz şablon bulunmuyor';
            }

            grid.innerHTML = `
                <div class="template-empty-state">
                    <div class="empty-icon">${emptyIcon}</div>
                    <h3>${emptyMessage}</h3>
                    <p>${emptyHint}</p>
                    ${showButton ? `<button class="btn" id="emptyStateAction">${buttonText}</button>` : ''}
                </div>
            `;

            if (showButton && buttonAction) {
                const btn = grid.querySelector('#emptyStateAction');
                if (btn) btn.onclick = buttonAction;
            }
            return;
        }

        templates.forEach(template => {
            const isFavorite = this.app.templateManager.favoriteTemplates.includes(template.id);
            const isUserTemplate = template.isUserTemplate || false;

            const card = document.createElement('div');
            card.className = 'template-card';
            card.innerHTML = `
                <div class="template-thumbnail" style="${template.thumbnail ? `background-image: url(${template.thumbnail}); background-size: cover; background-position: center;` : ''}">
                    ${!template.thumbnail ? '<div style="font-size: 48px; opacity: 0.3;">📋</div>' : ''}
                </div>
                <button class="template-favorite-btn ${isFavorite ? 'active' : ''}" data-template-id="${template.id}">
                    <svg viewBox="0 0 24 24" fill="${isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                </button>
                <button class="template-ncil-btn" data-template-id="${template.id}" title=".ncil olarak kaydet">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                    </svg>
                </button>
                ${isUserTemplate ? `
                <button class="template-delete-btn" data-template-id="${template.id}" title="Şablonu Sil">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                    </svg>
                </button>
                ` : ''}
                <div class="template-info">
                    <div class="template-name">${template.name}</div>
                    <div class="template-description">${template.description}</div>
                    <span class="template-category-badge">${template.category}</span>
                </div>
            `;

            // Apply template on click
            card.onclick = (e) => {
                if (e.target.closest('.template-favorite-btn') || e.target.closest('.template-delete-btn') || e.target.closest('.template-ncil-btn')) return;
                this.applyTemplateAndCreateBoard(template.id);
            };

            // Favorite toggle
            const favoriteBtn = card.querySelector('.template-favorite-btn');
            favoriteBtn.onclick = (e) => {
                e.stopPropagation();
                this.app.templateManager.toggleFavorite(template.id);
                this.renderTemplateGallery(category, searchQuery);
            };

            // .ncil olarak kaydet
            const ncilBtn = card.querySelector('.template-ncil-btn');
            if (ncilBtn) {
                ncilBtn.onclick = (e) => {
                    e.stopPropagation();
                    if (this.app.ncilFileManager) {
                        this.app.ncilFileManager.saveTemplateAsNcil(template);
                    }
                };
            }

            // Delete button (for user templates) - WITH CONFIRMATION
            const deleteBtn = card.querySelector('.template-delete-btn');
            if (deleteBtn) {
                deleteBtn.onclick = (e) => {
                    e.stopPropagation();

                    // Show confirmation dialog
                    this.showConfirmDialog({
                        title: 'Şablonu Sil',
                        message: `"${template.name}" şablonunu silmek istediğinize emin misiniz? Bu işlem geri alınamaz.`,
                        confirmText: 'Sil',
                        confirmClass: 'btn-danger',
                        onConfirm: () => {
                            // Store template data for undo
                            const templateData = { ...template };

                            const success = this.app.templateManager.deleteUserTemplate(template.id);
                            if (success) {
                                // Show undo toast
                                this.showUndoToast('Şablon silindi', () => {
                                    // Restore template
                                    this.app.templateManager.templates.push(templateData);
                                    this.app.templateManager.saveTemplates();
                                    this.renderTemplateGallery(category, searchQuery);
                                });

                                this.renderTemplateGallery(category, searchQuery);
                            }
                        }
                    });
                };
            }

            grid.appendChild(card);
        });
    }


    async applyTemplateAndCreateBoard(templateId) {
        // Create a new board first
        const id = 'b_' + Date.now();
        const template = this.app.templateManager.templates.find(t => t.id === templateId);

        const newBoard = {
            id: id,
            name: template ? template.name : 'Yeni Not',
            lastModified: Date.now(),
            favorite: false,
            deleted: false,
            objectCount: 0,
            preview: null,
            folderId: this.currentView.startsWith('f_') ? this.currentView : null,
            coverBg: '#4a90e2',
            coverTexture: 'none'
        };

        this.boards.push(newBoard);
        await this.saveDataAsync('wb_boards', this.boards);

        // Close template gallery
        this.closeTemplateGallery();

        // Load the board with templateId passed in
        // Await this to ensure the board is fully initialized before continuing
        await this.loadBoard(id, templateId);
    }
    setupBulkActions() {
        this.bulkToolbar = document.getElementById('bulkActionsToolbar');

        const btnCancel = document.getElementById('btnBulkCancel');
        if (btnCancel) btnCancel.onclick = () => this.clearSelection();

        const btnDelete = document.getElementById('btnBulkDelete');
        if (btnDelete) {
            btnDelete.onclick = async () => {
                const count = this.selectedBoards.size;
                if (count === 0) return;

                const isTrash = this.currentView === 'trash';
                const confirmed = await Utils.showConfirm({
                    title: isTrash ? 'Kalıcı Olarak Sil' : 'Notları Çöp Kutusuna Taşı',
                    message: isTrash 
                        ? `${count} notu kalıcı olarak silmek istediğinize emin misiniz?`
                        : `${count} notu çöp kutusuna taşımak istediğinize emin misiniz?`,
                    confirmText: isTrash ? 'Kalıcı Sil' : 'Çöp Kutusuna Taşı',
                    type: 'danger'
                });

                if (confirmed) {
                    const idsToProcess = Array.from(this.selectedBoards);
                    
                    if (isTrash) {
                        // Hard Delete: IndexedDB + File System cleanup in parallel
                        await Promise.all(idsToProcess.map(async id => {
                            const board = this.boards.find(b => b.id === id);
                            if (board) {
                                await window.fileSystemManager.removeItem(`wb_content_${id}`);
                                if (board.isPDF) {
                                    if (this._pdfInDbCache) this._pdfInDbCache.delete(id);
                                    Utils.db.delete(id).catch(err => console.error('PDF silme hatası:', err));
                                }
                            }
                        }));

                        // Update in-memory state
                        this.boards = this.boards.filter(b => !idsToProcess.includes(b.id));
                        
                        // Mark as deleted for sync
                        const deletedIds = await this.loadDataAsync('wb_deleted_ids', []);
                        let changed = false;
                        idsToProcess.forEach(id => {
                            if (!deletedIds.includes(id)) {
                                deletedIds.push(id);
                                changed = true;
                            }
                        });
                        if (changed) await this.saveDataAsync('wb_deleted_ids', deletedIds);
                        
                        // Immediate Drive sync
                        this._syncDeletionToDrive(idsToProcess);
                    } else {
                        // Soft Delete: Move to trash in memory
                        idsToProcess.forEach(id => {
                            const board = this.boards.find(b => b.id === id);
                            if (board) board.deleted = true;
                        });
                    }

                    // Save boards only once
                    await this.saveDataAsync('wb_boards', this.boards);

                    // Close tabs once
                    if (this.app.tabManager) {
                        idsToProcess.forEach(id => this.app.tabManager.closeTab(id));
                    }

                    this.clearSelection();
                }
            };
        }

        const btnShare = document.getElementById('btnBulkShare');
        if (btnShare) {
            btnShare.onclick = async () => {
                const idsToProcess = Array.from(this.selectedBoards);
                if (idsToProcess.length === 0) return;
                
                if (window.fileSystemManager) {
                    await window.fileSystemManager.exportBoards(idsToProcess);
                }
                this.clearSelection();
            };
        }

        const btnFav = document.getElementById('btnBulkFavorite');
        if (btnFav) {
            btnFav.onclick = async () => {
                const idsToProcess = Array.from(this.selectedBoards);
                if (idsToProcess.length === 0) return;

                idsToProcess.forEach(id => {
                    const board = this.boards.find(b => b.id === id);
                    if (board) {
                        board.favorite = !board.favorite;
                    }
                });

                // Save boards only once
                await this.saveDataAsync('wb_boards', this.boards);
                this.clearSelection();
            };
        }

        const btnCover = document.getElementById('btnBulkChangeCover');
        if (btnCover) {
            btnCover.onclick = (e) => {
                e.stopPropagation();
                this.openCoverPicker(null);
            };
        }

        const btnMove = document.getElementById('btnBulkMove');
        if (btnMove) {
            btnMove.onclick = (e) => {
                e.stopPropagation();
                this.showFolderPicker(async (folderId) => {
                    const folderIdFinal = folderId === "" ? null : folderId;
                    this.selectedBoards.forEach(id => {
                        const board = this.boards.find(b => b.id === id);
                        if (board) board.folderId = folderIdFinal;
                    });
                    await this.saveDataAsync('wb_boards', this.boards);
                    this.clearSelection();
                });
            };
        }
    }

    toggleBoardSelection(id, isSelected) {
        if (isSelected) {
            this.selectedBoards.add(id);
        } else {
            this.selectedBoards.delete(id);
        }

        // Update UI
        const card = document.querySelector(`.board-card[data-id="${id}"]`);
        if (card) {
            const checkbox = card.querySelector('.board-checkbox');
            if (checkbox) checkbox.checked = isSelected;

            if (isSelected) card.classList.add('selected');
            else card.classList.remove('selected');
        }

        this.updateBulkToolbar();
    }

    clearSelection() {
        this.selectedBoards.clear();
        this.renderBoards(); // Re-render to clear visual states
        this.updateBulkToolbar();
    }

    updateBulkToolbar() {
        if (!this.bulkToolbar) return;

        const count = this.selectedBoards.size;
        this.bulkToolbar.style.display = count > 0 ? 'flex' : 'none';
        this.bulkToolbar.querySelector('.selected-count').textContent = window.i18n.t('selected_count').replace('{count}', count);
    }

    async showFolderPicker(callback) {
        // Ensure folders are up to date
        this.folders = await this.loadDataAsync('wb_folders', []);

        const overlay = document.createElement('div');
        overlay.className = 'confirm-dialog-overlay';
        overlay.style.zIndex = '10001'; // Ensure it's above dashboard (9000)

        const modal = document.createElement('div');
        modal.className = 'confirm-dialog';
        modal.style.maxWidth = '400px';

        let html = `
            <h3>${window.i18n.t('select_folder')}</h3>
            <p style="margin-bottom: 16px; color: #666;">${window.i18n.t('move_notes_desc')}</p>
            <div style="max-height: 300px; overflow-y: auto; margin-bottom: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
                <div class="folder-picker-item" data-id="" style="padding: 12px 16px; cursor: pointer; border-bottom: 1px solid #f0f0f0; transition: background 0.2s; display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 18px;">
                    <app-icon name="folder"></app-icon>
                    </span>
                    <span>${window.i18n.t('root_directory')}</span>
                </div>
        `;

        const renderOptions = (parentId = null, level = 0) => {
            const children = this.folders.filter(f => (f.parentId || null) === parentId);
            children.forEach(f => {
                const paddingLeft = 16 + (level * 24);
                html += `
                    <div class="folder-picker-item" data-id="${f.id}" style="padding: 12px 16px; padding-left: ${paddingLeft}px; cursor: pointer; border-bottom: 1px solid #f0f0f0; transition: background 0.2s; display: flex; align-items: center; gap: 10px;">
                        <span style="font-size: 18px; ${level > 0 ? 'opacity: 0.7;' : ''}">${level > 0 ? '↳ ' : ''}<app-icon name="${f.icon || 'folder'}"></app-icon></span>
                        <div style="display: flex; flex-direction: column; overflow: hidden;">
                            <span style="font-weight: ${level === 0 ? '600' : '500'}; font-size: ${14 - (level * 0.5)}px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${f.name}</span>
                        </div>
                    </div>
                `;
                renderOptions(f.id, level + 1);
            });
        };

        renderOptions();

        html += `
            </div>
            <div class="confirm-dialog-actions">
                <button class="btn-cancel">İptal</button>
            </div>
        `;

        modal.innerHTML = html;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Add hover effects
        modal.querySelectorAll('.folder-picker-item').forEach(item => {
            item.onmouseover = () => item.style.background = '#f8f9fa';
            item.onmouseout = () => item.style.background = 'white';
            item.onclick = () => {
                callback(item.dataset.id || null);
                overlay.remove();
            };
        });

        // Cancel button
        modal.querySelector('.btn-cancel').onclick = () => overlay.remove();

        // Click outside to close
        overlay.onclick = (e) => {
            if (e.target === overlay) overlay.remove();
        };
    }

    setupSortActions() {
        if (!this.btnSortFolders || !this.btnSortNotes) return;

        // Folder sorting dropdown toggle
        const toggleFoldersDropdown = (e) => {
            e.stopPropagation();
            const isOpen = this.sortFoldersDropdown.classList.contains('show');
            
            // Close other dropdowns
            document.querySelectorAll('.view-options-dropdown, .sort-options-dropdown, .sort-folders-dropdown').forEach(d => d.classList.remove('show'));
            
            if (!isOpen) {
                this.sortFoldersDropdown.classList.add('show');
            }
        };

        if (this.btnSortFolders) this.btnSortFolders.onclick = toggleFoldersDropdown;
        if (this.btnSortFoldersHeader) this.btnSortFoldersHeader.onclick = toggleFoldersDropdown;

        // Folder sort buttons
        this.sortFoldersDropdown.querySelectorAll('.sort-folders-btn').forEach(btn => {
            btn.onclick = () => {
                // Currently folders only sort by name
                this.updateSortUI();
            };
        });

        this.sortFoldersDropdown.querySelectorAll('.order-folders-btn').forEach(btn => {
            btn.onclick = async () => {
                this.folderSortOrder = btn.dataset.order;
                await this.saveDataAsync('wb_folder_sort_order', this.folderSortOrder);
                this.updateSortUI();
                this.renderSidebar();
            };
        });

        // Note sorting dropdown toggle
        this.btnSortNotes.onclick = (e) => {
            e.stopPropagation();
            const isOpen = this.sortOptionsDropdown.classList.contains('show');
            
            // Close other dropdowns
            document.querySelectorAll('.view-options-dropdown, .sort-options-dropdown, .sort-folders-dropdown').forEach(d => d.classList.remove('show'));
            
            if (!isOpen) {
                this.sortOptionsDropdown.classList.add('show');
            }
        };

        // Close dropdowns when clicking outside
        const closeDropdownListener = (e) => {
            if (this.sortFoldersDropdown && !this.sortFoldersDropdown.contains(e.target) && 
                (!this.btnSortFolders || !this.btnSortFolders.contains(e.target)) &&
                (!this.btnSortFoldersHeader || !this.btnSortFoldersHeader.contains(e.target))) {
                this.sortFoldersDropdown.classList.remove('show');
            }
            if (this.sortOptionsDropdown && !this.sortOptionsDropdown.contains(e.target) && !this.btnSortNotes.contains(e.target)) {
                this.sortOptionsDropdown.classList.remove('show');
            }
        };
        document.addEventListener('click', closeDropdownListener);

        // Board sort buttons
        this.sortOptionsDropdown.querySelectorAll('.sort-btn').forEach(btn => {
            btn.onclick = async () => {
                this.boardSortField = btn.dataset.sort;
                await this.saveDataAsync('wb_board_sort_field', this.boardSortField);
                this.updateSortUI();
                this.renderBoards();
            };
        });

        // Board order buttons
        this.sortOptionsDropdown.querySelectorAll('.order-btn').forEach(btn => {
            btn.onclick = async () => {
                this.boardSortOrder = btn.dataset.order;
                await this.saveDataAsync('wb_board_sort_order', this.boardSortOrder);
                this.updateSortUI();
                this.renderBoards();
            };
        });

        this.updateSortUI();
    }

    updateSortUI() {
        if (!this.sortOptionsDropdown) return;
        
        // Update active classes for board sort buttons
        this.sortOptionsDropdown.querySelectorAll('.sort-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.sort === this.boardSortField);
        });

        this.sortOptionsDropdown.querySelectorAll('.order-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.order === this.boardSortOrder);
        });

        // Update active classes for folder sort buttons
        if (this.sortFoldersDropdown) {
            this.sortFoldersDropdown.querySelectorAll('.order-folders-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.order === this.folderSortOrder);
            });
        }

        // Update folder sort button active state
        const isFolderSorted = this.folderSortOrder !== 'none';
        this.btnSortFolders?.classList.toggle('active', isFolderSorted);
        this.btnSortFoldersHeader?.classList.toggle('active', isFolderSorted);
        
        // Update folder sort icons based on state
        const updateFolderIcon = (btn) => {
            if (!btn) return;
            const icon = btn.querySelector('app-icon');
            if (icon) {
                if (this.folderSortOrder === 'asc') icon.setAttribute('name', 'arrow-up');
                else if (this.folderSortOrder === 'desc') icon.setAttribute('name', 'arrow-down');
                else icon.setAttribute('name', 'switch-vertical-01');
            }
        };
        updateFolderIcon(this.btnSortFolders);
        updateFolderIcon(this.btnSortFoldersHeader);
    }

    setupSelectAll() {
        if (this.btnSelectAll) {
            this.btnSelectAll.onclick = () => this.toggleSelectAll();
        }
        if (this.btnSelectAllMobile) {
            this.btnSelectAllMobile.onclick = () => this.toggleSelectAll();
        }
    }

    getFilteredBoards() {
        // Refresh data to ensure we have latest states
        // Note: this.boards and this.folders should already be up to date from mutations
        // but we ensure it's an array for safety.
        if (!Array.isArray(this.boards)) this.boards = [];

        let filtered = [];

        if (this.currentView === 'trash') {
            filtered = this.boards.filter(b => b.deleted);
        } else {
            // Base filter: non-deleted
            let base = this.boards.filter(b => !b.deleted);

            if (this.currentView === 'all') {
                filtered = base;
            } else if (this.currentView === 'recent') {
                filtered = [...base].sort((a, b) => b.lastModified - a.lastModified).slice(0, 10);
            } else if (this.currentView === 'favorites') {
                filtered = base.filter(b => b.favorite);
            } else if (this.currentView.startsWith('f_')) {
                filtered = base.filter(b => b.folderId === this.currentView);
            } else {
                filtered = base;
            }
        }

        // Apply Search Filter
        if (this.searchTerm) {
            filtered = filtered.filter(b => b.name.toLowerCase().includes(this.searchTerm));
        }

        return filtered;
    }

    toggleSelectAll() {
        const filtered = this.getFilteredBoards();
        if (filtered.length === 0) return;

        const allSelected = filtered.every(b => this.selectedBoards.has(b.id));

        if (allSelected) {
            this.clearSelection();
        } else {
            this.selectAll(filtered);
        }
    }

    selectAll(boardsToSelect) {
        boardsToSelect.forEach(b => this.selectedBoards.add(b.id));
        this.renderBoards();
        this.updateBulkToolbar();
    }

    updateSelectAllButtonState(filteredBoards) {
        const desktopBtn = this.btnSelectAll;
        const mobileBtn = this.btnSelectAllMobile;
        if (!desktopBtn && !mobileBtn) return;

        const filtered = filteredBoards || [];
        const noItems = filtered.length === 0;

        [desktopBtn, mobileBtn].forEach(btn => {
            if (!btn) return;
            if (noItems) {
                btn.style.opacity = '0.3';
                btn.style.pointerEvents = 'none';
                btn.title = "Seçilecek not yok";
            } else {
                btn.style.opacity = '1';
                btn.style.pointerEvents = 'auto';
            }
        });

        if (noItems) return;

        const allSelected = filtered.every(b => this.selectedBoards.has(b.id));

        [desktopBtn, mobileBtn].forEach(btn => {
            if (!btn) return;
            if (allSelected) {
                btn.classList.add('active');
                btn.title = "Seçimi Temizle (Ctrl+A)";
            } else {
                btn.classList.remove('active');
                btn.title = "Tümünü Seç (Ctrl+A)";
            }
        });
    }

    updateTodayNotesBadge() {
        if (!this.todayNotesBadge || !this.todayNotesPopup) return;

        const today = new Date();
        const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        
        const todayNotes = (this.boards || []).filter(n => {
            const noteDate = new Date(n.lastModified);
            const nDateStr = `${noteDate.getFullYear()}-${String(noteDate.getMonth() + 1).padStart(2, '0')}-${String(noteDate.getDate()).padStart(2, '0')}`;
            return nDateStr === dateStr && !n.deleted;
        });

        if (todayNotes.length > 0) {
            this.todayNotesBadge.style.display = 'flex';
            const countEl = this.todayNotesBadge.querySelector('.badge-count');
            if (countEl) countEl.textContent = todayNotes.length;

            // Render popup content
            let popupHtml = `<div class="popup-title">${window.i18n.t('today_notes_count').replace('{count}', todayNotes.length)}</div>`;
            popupHtml += todayNotes.map(n => `
                <div class="popup-note-item" onclick="event.stopPropagation(); window.dashboard.loadBoard('${n.id}')">
                    <span class="popup-note-dot" style="background:${n.coverBg || '#4dabf7'}"></span>
                    <span class="popup-note-name" title="${n.name}">${n.name}</span>
                </div>
            `).join('');
            this.todayNotesPopup.innerHTML = popupHtml;

            // Click badge to go to calendar
            this.todayNotesBadge.onclick = () => {
                this.switchView('calendar');
                if (window.calendar) {
                    window.calendar.selectDate(dateStr);
                }
            };
        } else {
            this.todayNotesBadge.style.display = 'none';
        }
    }

    setupAutoSync() {
        if (!localStorage.getItem(`${APP_CONFIG.STORAGE_PREFIX}gdrive_token`)) return;

        let syncTimer = null;
        const cloud = this.getCloudSync();

        // UI İndikatörü Oluştur (Görsel Deneyim)
        const createSyncIndicator = () => {
            let el = document.getElementById('syncIndicator');
            if (!el) {
                el = document.createElement('div');
                el.id = 'syncIndicator';
                el.style.cssText = `
                    position: fixed; bottom: 20px; right: 20px; z-index: 9999;
                    background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(10px);
                    padding: 8px 16px; border-radius: 20px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);
                    display: none; align-items: center; gap: 10px; font-size: 13px; font-weight: 500;
                    border: 1px solid rgba(255,255,255,0.3); transition: all 0.3s ease;
                    transform: translateY(10px); opacity: 0;
                `;
                el.innerHTML = `
                    <div class="sync-spinner" style="width: 14px; height: 14px; border: 2px solid #4a90e2; border-top-color: transparent; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                    <span class="sync-text">${window.i18n.t('syncing_with_cloud')}</span>
                `;
                document.body.appendChild(el);
            }
            return el;
        };

        const showSync = (text = window.i18n.t('syncing_with_cloud')) => {
            const el = createSyncIndicator();
            el.querySelector('.sync-text').textContent = text;
            el.style.display = 'flex';
            el.offsetHeight; // Force reflow
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        };

        const hideSync = () => {
            const el = document.getElementById('syncIndicator');
            if (el) {
                el.style.opacity = '0';
                el.style.transform = 'translateY(10px)';
                setTimeout(() => { el.style.display = 'none'; }, 300);
            }
        };

        const triggerSync = (targetId = null) => {
            if (syncTimer) clearTimeout(syncTimer);
            syncTimer = setTimeout(async () => {
                showSync();
                const res = await cloud.syncWithGoogleDrive(targetId);
                if (res.success && (res.syncCount > 0 || res.delta)) {
                    await this.initAsync();
                }
                hideSync();
            }, 3000); // 3 saniye debounce
        };

        // 1. Auto-Push (Debounced Delta Sync)
        window.fileSystemManager.onSave = (key) => {
            if (key.startsWith('wb_content_')) {
                // Board içeriği değişti: delta sync ile sadece bu board'u yükle
                const boardId = key.replace('wb_content_', '');
                if (boardId && boardId !== 'null' && boardId !== 'undefined') {
                    triggerSync(boardId);
                }
            } else if (key === 'wb_boards' || key === 'wb_folders') {
                // Klasör/board listesi değişti: manifest güncelle (full sync ama sessizce)
                triggerSync(null);
            }
            // wb_deleted_ids, wb_view_settings gibi diğer key'ler için sync tetiklemiyoruz
        };

        window.fileSystemManager.onRemove = (key) => {
            const id = key.startsWith('wb_content_') ? key.replace('wb_content_', '') : null;
            if (id && id !== 'null' && id !== 'undefined') {
                triggerSync(id);
            } else {
                triggerSync(null);
            }
        };

        // 2. Connectivity Support (Offline Queue)
        window.addEventListener('online', () => {
            console.log('[AutoSync] İnternet geri geldi, bekleyen işlemler işleniyor...');
            cloud.processPendingQueue();
        });

        // 3. Auto-Pull (Full Sync Polling)
        setInterval(async () => {
            if (document.visibilityState === 'visible' && navigator.onLine) {
                console.log('[AutoSync] Periyodik kontrol...');
                const res = await cloud.syncWithGoogleDrive();
                if (res.success && res.syncCount > 0) {
                    await this.initAsync();
                }
            }
        }, 120000); // 2 dakikada bir full kontrol
    }

    renderLanguageList() {
        const listContainer = document.getElementById('languageList');
        if (!listContainer) return;

        const languages = [
            { code: 'tr', name: window.i18n.t('lang_tr') },
            { code: 'en', name: window.i18n.t('lang_en') },
            { code: 'de', name: window.i18n.t('lang_de') },
            { code: 'fr', name: window.i18n.t('lang_fr') },
            { code: 'es', name: window.i18n.t('lang_es') }
        ];

        listContainer.innerHTML = '';
        languages.forEach(lang => {
            const isActive = window.i18n.currentLang === lang.code;
            const item = document.createElement('div');
            item.className = `language-item ${isActive ? 'active' : ''}`;
            item.innerHTML = `
                <span class="language-name">${lang.name}</span>
                <span class="language-check">
                    <app-icon name="check" style="width: 18px; height: 18px;"></app-icon>
                </span>
            `;
            item.onclick = () => window.i18n.setLanguage(lang.code);
            listContainer.appendChild(item);
        });
    }
}

