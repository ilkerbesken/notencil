# 🎨 notencil - Professional Digital Whiteboard & Note-Taking Application

notencil, modern web teknolojileri (HTML5, CSS3, ES6+) ve GPU hızlandırma (WebGPU) kullanılarak geliştirilmiş, düşük gecikmeli (low-latency) ve yüksek performanslı bir dijital beyaz tahta uygulamasıdır. Hem yaratıcı çizim süreçleri hem de profesyonel not alma ihtiyaçları için tablet kalitesinde bir deneyim sunar.

---

## 🚀 Öne Çıkan Özellikler

### ✒️ Gelişmiş Çizim ve Yazım Motoru
- **WebGPU Hızlandırma:** Binlerce nesnenin bulunduğu devasa tuvallerde bile 60+ FPS performans sağlayan GPU tabanlı render motoru.
- **Basınç Hassasiyeti:** Stylus/Kalem girişlerinde gerçek zamanlı basınç algılama ve doğal çizgi kalınlığı değişimi.
- **Pürüzsüz Çizgiler:** Weighted Moving Average ve Chaikin algoritması ile titremesiz çizimler.
- **Özel Fırçalar:** Vurgulayıcı, dolma kalem (fountain pen), füzen (charcoal) ve vektörel kalem seçenekleri.

### 🧠 Akıllı Araçlar ve OCR
- **Yapay Zeka Destekli OCR:** Tesseract.js entegrasyonu ile resim ve PDF'lerdeki metinleri otomatik tanıma ve seçilebilir hale getirme.
- **Dinamik Tablolar:** Satır/sütun eklenebilen, hücreleri zengin metin içeren akıllı tablolar.
- **Akıllı Bağlantılar:** Şemalar için otomatik yönlenen ve uçları özelleştirilebilen oklar.
- **Vektörel Şekiller:** Dikdörtgen, elips, yıldız, bulut gibi 15+ geometrik şekil ve zengin metin kutuları.

### 📂 Doküman ve Bulut Yönetimi
- **PDF Entegrasyonu:** PDF dosyalarını içe aktarma, üzerinde not alma ve sayfalar arası navigasyon.
- **Google Drive Senkronizasyonu:** Cihazlar arası çift yönlü, gerçek zamanlı bulut senkronizasyonu.
- **Masaüstü ve Mobil:** PWA desteği sayesinde tarayıcıdan yüklenebilir veya Electron ile masaüstü uygulaması olarak kullanılabilir.
- **.ncil Formatı:** Gzip ile sıkıştırılmış, optimize edilmiş özel dosya formatı.

---

## 🏗️ Teknik Mimari

Proje, sürdürülebilirlik ve performans için modüler bir mimari üzerine kurulmuştur:

1. **Çekirdek Durum Yönetimi (`app.js`):** Uygulamanın araç durumunu ve nesne yaşam döngüsünü koordine eder.
2. **GPU Rendering (`WebGPURenderer.js`):** Karmaşık çizimleri tarayıcının grafik işlemcisine (GPU) aktararak işlemci yükünü azaltır.
3. **OCR Katmanı (`OCRManager.js`):** Arka planda çalışan worker'lar ile görüntü işleme ve metin tanıma süreçlerini yönetir.
4. **Hibrit Depolama:**
   - **FileSystem API:** Yerel klasörlerle doğrudan etkileşim.
   - **IndexedDB:** Büyük verilerin (PDF'ler, resimler) performanslı saklanması.

---

## 🛠️ Teknoloji Yığını

- **Dil:** JavaScript (ES6+), Vanilla HTML5/CSS3.
- **Masaüstü:** [Electron](https://www.electronjs.org/) (Windows, macOS, Linux).
- **Kütüphaneler:**
  - [PDF.js](https://mozilla.github.io/pdf.js/) - PDF işleme.
  - [Tesseract.js](https://tesseract.projectnaptha.com/) - OCR (Optik Karakter Tanıma).
  - [Pako](https://github.com/nodeca/pako) - Gzip sıkıştırma.
  - [Dexie.js](https://dexie.org/) - IndexedDB yönetimi.

---

## 🚀 Başlarken

### Geliştirme Ortamı
1. Bağımlılıkları yükleyin:
   ```bash
   npm install