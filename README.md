# Buku Tagihan v2 — Login Resmi, Privat, Komisi Penagih

Proyek GitHub & Vercel Anda sudah ada — cukup GANTI isi file-file di repo GitHub dengan file-file baru ini
(hapus file lama, upload semua file dari folder ini), Vercel akan otomatis build ulang.

## Langkah 1 — Aktifkan Login (Firebase Authentication)

1. Buka Firebase Console → project Anda (pts-d7256) → menu kiri "Build" atau langsung cari "Authentication".
2. Klik "Get started".
3. Pilih metode "Email/Password" → aktifkan (toggle) → Save.
4. Klik tab "Users" → "Add user". Buat 5 akun:
   - 1 untuk Admin, misal: admin@bukutagihan.com
   - 4 untuk penagih, misal: penagih1@bukutagihan.com, penagih2@..., dst.
   - Boleh pakai email asal apa saja (tidak harus email asli/aktif), yang penting Anda ingat kata sandinya.
5. Setelah tiap akun dibuat, akan muncul kode acak panjang di kolom "User UID" — SALIN kode itu untuk tiap akun (akan dipakai di Langkah 2).

## Langkah 2 — Daftarkan peran tiap akun (Firestore)

1. Di Firebase Console, buka "Firestore Database" → tab "Data".
2. Klik "Start collection" → Collection ID: `users` → Next.
3. Untuk akun ADMIN: Document ID = (tempel UID admin dari Langkah 1). Tambah field:
   - `role` (string) = `admin`
   - `nama` (string) = nama Anda
   → Save.
4. Untuk TIAP akun penagih (ulangi 4 kali), klik "Add document" di collection `users`:
   - Document ID = UID penagih tersebut
   - field `role` (string) = `penagih`
   - field `nama` (string) = nama penagih itu
   → Save.

## Langkah 3 — Pasang aturan keamanan

1. Di Firestore Database, klik tab "Rules".
2. Hapus semua isi kotak itu, ganti dengan isi file `firestore.rules` yang ada di folder proyek ini (copy-paste semuanya).
3. Klik "Publish".

## Langkah 4 — Upload ke GitHub & biarkan Vercel deploy otomatis

1. Buka repository GitHub Anda (TAGIHAN-ONLINE) di browser.
2. Hapus file-file lama (atau langsung upload file baru menimpa yang lama dengan nama sama — GitHub akan tanya "replace").
3. Upload SEMUA isi folder ini (termasuk file `firestore.rules`, walau itu cuma untuk arsip/rujukan, bukan dipakai saat build).
4. Commit changes.
5. Vercel otomatis mendeteksi perubahan dan build ulang dalam 1-2 menit. Buka link Vercel Anda untuk lihat hasilnya.

## Cara pakai sehari-hari

- **Admin** login pakai email/password admin → bisa tambah pelanggan baru, ubah data (nama/daerah/harga/status/assign penagih), lihat laporan lengkap per daerah, lihat komisi tiap penagih, dan buka riwayat bulan-bulan sebelumnya.
- **Penagih** login pakai email/password masing-masing → HANYA melihat pelanggan yang ditugaskan ke mereka, dan HANYA bisa isi dropdown status bayar + keterangan. Tidak bisa ubah nama/harga/daerah, tidak bisa tambah pelanggan baru.
- Setiap tanggal 1, sistem otomatis "mulai lembar baru" — data bulan sebelumnya tetap tersimpan selamanya dan bisa dibuka lewat tab "Riwayat Bulan" (khusus Admin). Tidak perlu reset manual.
- Kalau seorang pelanggan ditandai "Belum Bayar — Dobel Bulan Depan", tagihannya bulan depan otomatis 2x lipat sampai dia bayar lunas.
- Komisi penagih dihitung otomatis: Rp4.000 × jumlah pelanggan yang berhasil ditarik (cash/transfer) bulan itu.

## Menambah/menghapus akun penagih di kemudian hari

Ulangi Langkah 1 & 2 untuk akun baru. Untuk menonaktifkan akun, hapus/nonaktifkan user-nya di tab Authentication.

## Catatan keamanan

Aturan di `firestore.rules` sudah memastikan hanya akun yang login (dan terdaftar di collection `users`) yang
bisa membaca/menulis data — orang luar tidak bisa akses sama sekali. Pembatasan "penagih hanya boleh isi
status & keterangan" saat ini ditegakkan di tampilan aplikasi; kalau ingin penguncian lebih ketat di level
server (menolak permintaan curang walau seseorang mengutak-atik lewat cara teknis), itu pengembangan lanjutan
yang bisa dibantu developer atau Claude Code.
