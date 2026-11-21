# Simulator Dinamika Suhu Ruangan dengan Pemanas

TA-07 Pemodelan dan Simulasi, Universitas Bale Bandung, Teknik Informatika 4B.

Aplikasi web untuk mensimulasikan suhu ruangan yang dipanaskan memakai metode Euler.

Model: C * dT/dt = Q_heater - UA * (T - T_luar)

## Fitur
- Simulasi Euler dengan parameter yang bisa diubah (slider dan input angka)
- Skenario What-If: pemanas turun 50%, jendela dibuka, step pemanas dan suhu luar sinusoida
- Perbandingan dengan baseline TP-07 dan solusi analitik
- Uji pengaruh step size (dt) terhadap akurasi Euler
- Tabel data, unduh grafik (PNG) dan data (CSV)

## Menjalankan di komputer lokal
```
python -m venv venv
venv\Scripts\activate          (Windows)
source venv/bin/activate       (Linux/Mac)
pip install -r requirements.txt
python app.py
```
Buka http://127.0.0.1:5000

## Isi repo
- app.py                      backend Flask dan logika Euler
- templates/index.html        halaman web
- static/css, static/js       tampilan dan interaksi
- TA07_suhu_ruangan.ipynb     notebook analisis (simulasi, What-If, validasi dataset)
- data/IOT-temp.csv           dataset Kaggle Temperature Readings: IoT Devices (dipakai notebook)

## Link deploy
(tempel link di sini setelah deploy)
