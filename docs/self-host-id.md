# Panduan Cepat: Menjalankan Zettagrid VMware MCP Server Sendiri

Panduan ini untuk pelanggan dan mitra yang ingin menjalankan server MCP ini di lingkungan
sendiri, terhubung langsung ke VMware Cloud Director (VCD) milik Anda sendiri.

**Model ini disengaja:** kredensial VCD Anda tetap berada di lingkungan Anda sendiri dan tidak
pernah dikirimkan ke Zettagrid Indonesia. Server ini hanya menjadi perantara langsung antara
asisten AI Anda (Claude Desktop atau Claude Code) dan API VCD Anda.

---

## 1. Prasyarat

- Node.js 18 atau lebih baru, dan npm
- Token API Zettagrid yang valid untuk zona yang Anda gunakan
- Akses ke Claude Desktop atau Claude Code

## 2. Mendapatkan Token API

Token API diterbitkan per zona melalui portal pelanggan Zettagrid. Jika Anda belum memiliki
token, hubungi tim dukungan Zettagrid melalui kanal normal Anda untuk memintanya.

Otorisasi tool sepenuhnya ditentukan oleh peran (role) VCD yang melekat pada token API Anda —
server ini tidak memberikan akses apa pun di luar yang sudah diizinkan oleh token tersebut.

## 3. Instalasi

```bash
git clone https://github.com/ArupaCloudNusantara/zettagrid-vmware-mcp.git
cd zettagrid-vmware-mcp
npm install
cp .env.example .env
npm run build
```

## 4. Konfigurasi `.env`

Edit file `.env` yang baru dibuat. Contoh konfigurasi untuk satu zona (Jakarta):

```bash
ZETTAGRID_ORGANIZATION=nama-organisasi-anda
ZETTAGRID_DEFAULT_ZONE=jakarta

# Hanya konfigurasikan zona yang Anda miliki aksesnya:
ZETTAGRID_API_TOKEN_JAKARTA=token-jakarta-anda

TRANSPORT=stdio
```

Zona yang tersedia: `sydney`, `melbourne`, `perth`, `brisbane`, `adelaide`, `darwin`,
`jakarta`, `cibitung`. Anda hanya perlu mengonfigurasi zona yang benar-benar Anda gunakan —
zona lain akan dilewati secara otomatis dengan peringatan saat server dijalankan.

## 5. Mendaftarkan ke Claude Desktop

Buka file konfigurasi berikut sesuai sistem operasi Anda:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

Tambahkan entri berikut (sesuaikan path absolut dan kredensial Anda):

```json
{
  "mcpServers": {
    "zettagrid": {
      "command": "node",
      "args": ["/path/absolut/ke/zettagrid-vmware-mcp/build/index.js"],
      "env": {
        "ZETTAGRID_ORGANIZATION": "nama-organisasi-anda",
        "ZETTAGRID_DEFAULT_ZONE": "jakarta",
        "ZETTAGRID_API_TOKEN_JAKARTA": "token-jakarta-anda",
        "ZETTAGRID_API_VERSION": "39.1"
      }
    }
  }
}
```

Restart Claude Desktop setelah menyimpan perubahan.

## 6. Mendaftarkan ke Claude Code

Jalankan perintah berikut satu kali dari direktori proyek:

```bash
claude mcp add zettagrid \
  -e ZETTAGRID_DEFAULT_ZONE=jakarta \
  -e ZETTAGRID_API_VERSION=39.1 \
  -e ZETTAGRID_API_TOKEN_JAKARTA=token-jakarta-anda \
  -e ZETTAGRID_ORGANIZATION=nama-organisasi-anda \
  -- node /path/absolut/ke/zettagrid-vmware-mcp/build/index.js
```

## 7. Memverifikasi Koneksi

```bash
claude mcp list
# zettagrid: node .../build/index.js - ✔ Connected
```

Jika status bukan "Connected", periksa bagian "Hal-hal yang Sering Terlewat" di bawah ini
sebelum melaporkan masalah.

---

## Hal-hal yang Sering Terlewat

Ini adalah masalah paling umum yang ditemui saat pemasangan pertama kali:

- **Entry point harus `build/index.js`** — bukan `build/server/mcp-server.js`. File tersebut
  tidak memuat `dotenv` dan akan gagal secara diam-diam (tanpa pesan error yang jelas).
- **Nama organisasi harus benar di URL OAuth** — `.env.example` menyertakan placeholder
  `your-organization-name`; pastikan sudah diganti dengan nama organisasi Anda yang
  sebenarnya, persis seperti yang tercantum di portal Zettagrid.
- **Registrasi bersifat project-scoped** — buka Claude Code dari direktori proyek ini agar
  tool-nya muncul di sesi Anda.
- **Restart diperlukan** — tool baru hanya tersedia setelah Claude Code atau Claude Desktop
  di-restart, bukan pada sesi yang sama saat Anda menjalankan `claude mcp add`.

## Butuh Bantuan Lebih Lanjut?

- Untuk masalah pada perangkat lunak ini (bug, error konfigurasi): buka issue di
  [GitHub repository](https://github.com/ArupaCloudNusantara/zettagrid-vmware-mcp/issues).
- Untuk masalah pada layanan Zettagrid Anda (token, kuota, konektivitas VCD): hubungi dukungan
  Zettagrid melalui kanal normal Anda. Perangkat lunak ini bukan bagian dari penawaran layanan
  Zettagrid resmi dan tidak tercakup dalam SLA dukungan Zettagrid.
