# Fiber Network Inventory Monitoring — Prototype
Unit SDI — PT Telkom Akses Branch Tarakan | Academic Prototype — Data Science, Telkom University Surabaya.

Dashboard ini menggunakan data simulasi untuk keperluan akademik dan tidak merepresentasikan data aktual PT Telkom Akses.

## Menjalankan
- Lokal: buka `index.html` langsung di browser (tanpa server/backend).
- GitHub Pages: unggah seluruh isi folder ke repositori, lalu Settings → Pages → Deploy from branch (root).

## Struktur
- `index.html` — halaman tunggal, 4 menu (Overview, Network Inventory, Data Quality, Data Explorer)
- `assets/adminator.css` — stylesheet template Adminator; `assets/custom.css` — penyesuaian
- `assets/chart.umd.js` — Chart.js 4.4.1 (lokal, tanpa CDN); `assets/app.js` — logika
- `assets/data.js` — salinan `data/inventory_simulasi.csv` agar jalan dari `file://`
- `data/` — `inventory_simulasi.csv`, `data_dictionary.csv`

## Catatan perhitungan
- Semua angka dihitung di `assets/app.js` dari dataset; filter wilayah/jenis berlaku di semua halaman.
- Utilisasi port: hanya ODP yang lolos seluruh validasi (cocok dengan KPI di dataset_sdi_simulasi.xlsx).
- Port kosong pada ODC tidak dihitung sebagai masalah.
- Jika CSV diganti: salin isinya ke `assets/data.js` (variabel `INVENTORY_CSV`).
