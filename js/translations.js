class I18nManager {
    constructor() {
        this.currentLang = localStorage.getItem('app_language') || 'tr';
        this.data = {};
        this.isLoaded = false;
        this.ready = this.init();
    }

    async init() {
        document.documentElement.lang = this.currentLang;
        await this.loadLanguage(this.currentLang);
        
        // Run translation on next tick to ensure DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.applyTranslations());
        } else {
            this.applyTranslations();
        }
    }

    async loadLanguage(lang) {
        try {
            const response = await fetch(`./locales/${lang}.json`);
            if (!response.ok) throw new Error(`Could not load language: ${lang}`);
            this.data = await response.json();
            this.currentLang = lang;
            this.isLoaded = true;
            document.documentElement.lang = lang;
            return true;
        } catch (error) {
            console.error('I18n Error:', error);
            // Fallback to empty data to prevent crashes
            this.data = this.data || {};
            return false;
        }
    }

    async setLanguage(lang) {
        const success = await this.loadLanguage(lang);
        if (success) {
            localStorage.setItem('app_language', lang);
            this.applyTranslations();
            
            // Dispatch event for other components to update
            window.dispatchEvent(new CustomEvent('languageChanged', { detail: lang }));
        }
    }

    t(key) {
        if (!this.isLoaded) return key;
        return this.data[key] || key;
    }

    applyTranslations() {
        const elements = document.querySelectorAll('[data-i18n]');
        elements.forEach(el => {
            const key = el.getAttribute('data-i18n');
            const translation = this.t(key);
            
            if (el.tagName === 'INPUT' && el.placeholder) {
                el.placeholder = translation;
            } else {
                el.textContent = translation;
            }
        });
        
        // Update tooltips/titles
        const titledElements = document.querySelectorAll('[data-i18n-title]');
        titledElements.forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            el.title = this.t(key);
        });
    }
}

window.i18n = new I18nManager();
