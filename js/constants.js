// Canvas için sabit mantıksal boyutlar
// Bu değerler tüm uygulama boyunca tutarlı olmalıdır
// Responsive tasarımda canvas CSS ile ölçeklendirilir ama
// internal koordinat sistemi bu sabit boyutlarda kalır

const CANVAS_CONSTANTS = {
    LOGICAL_WIDTH: 1920,
    LOGICAL_HEIGHT: 1080
};

const APP_CONFIG = {
    NAME: "notencil",
    ID: "notencil",
    STORAGE_PREFIX: "notencil_",
    FILE_EXTENSION: ".ncil",
    MIME_TYPE: "application/x-notencil",
    CACHE_NAME: "notencil-v1",
    TOAST_ID: "notencil-toast",
    GDRIVE_FOLDER: "notencil",
    MANIFEST_FILE: "notencil-manifest.json",
    SIGNATURE: "NOTENCIL!" // Dosya formatı imzası (9 karakter)
};
