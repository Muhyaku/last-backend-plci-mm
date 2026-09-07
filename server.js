const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// 1. KONEKSI MONGODB
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ BOOM! Berhasil terhubung ke MongoDB!'))
  .catch((err) => console.error('❌ Gagal connect ke MongoDB:', err));

// SCHEMA LAPORAN DARURAT
const emergencySchema = new mongoose.Schema({
  sheet: { type: String, required: true },
  message: { type: String, default: "Sistem Error / Butuh Bantuan" },
  status: { type: String, enum: ['ACTIVE', 'SOLVED'], default: 'ACTIVE' }, // ACTIVE = Muncul terus
  timestamp: { type: String, required: true }
}, { timestamps: true });
const Emergency = mongoose.model('Emergency', emergencySchema);

// 2. SCHEMA TRANSAKSI
const transactionSchema = new mongoose.Schema({
  sheet: { type: String, required: true, index: true },
  tanggal: { type: String, required: true, index: true },
  cash: { type: Number, default: 0 },
  bca: { type: Number, default: 0 },
  gofood: { type: Number, default: 0 },
  jenisPengeluaran: { type: String, default: "" },
  totalPengeluaran: { type: Number, default: 0 },
  isDeleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },
  printCount: { type: Number, default: 0 }
}, { timestamps: true });
const Transaction = mongoose.model('Transaction', transactionSchema);

// 3. SCHEMA BIAYA TETAP ROUTINE
const recurringSchema = new mongoose.Schema({
  sheet: { type: String, required: true },
  nama: { type: String, required: true },
  nominal: { type: Number, required: true },
  startDate: { type: Date, required: true },
  endDate: { type: Date, default: null }, 
  frekuensi: { type: String, enum: ['bulanan', 'tahunan', 'harian'], required: true },
  intervalHari: { type: Number, default: 0 },
  lastApplied: { type: Date, default: null },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
const Recurring = mongoose.model('Recurring', recurringSchema);

// 4. SCHEMA SETTINGS DINAMIS
const settingSchema = new mongoose.Schema({
  settingKey: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  isActive: { type: Boolean, default: false },
  branches: { type: [String], default: [] }, // Filter cabang mana yg kena efek
  description: { type: String, default: "" }
}, { timestamps: true });
const Setting = mongoose.model('Setting', settingSchema);

// INIT DEFAULT SETTINGS JIKA KOSONG
const initSettings = async () => {
  const count = await Setting.countDocuments();
  if (count === 0) {
    await Setting.insertMany([
      { settingKey: 'scramble_keypad', name: 'Acak Tombol PIN Kasir', description: 'Mengacak posisi angka di layar login untuk mencegah orang menghapal gerakan jari kasir (Anti-Ngintip).', isActive: false, branches: [] },
      { settingKey: 'pin_table_column', name: 'Bekukan Kolom Tabel (Pin Header)', description: 'Membekukan kolom Aksi dan Total di laporan agar tidak ikut tergeser saat di-scroll menyamping (Cocok untuk Layar Tablet).', isActive: true, branches: [] },
      { settingKey: 'multi_delete', name: 'Fitur Hapus Masal (Multi-Delete)', description: 'Mengaktifkan kotak centang (checkbox) pada tabel laporan admin untuk menghapus banyak data sekaligus (Sementara / Permanen).', isActive: false, branches: [] }
    ]);
  } else {
    // Fallback otomatis buat nambahin fitur delete masal di DB yang udah jalan
    const hasMultiDelete = await Setting.findOne({ settingKey: 'multi_delete' });
    if (!hasMultiDelete) {
        await Setting.create({ settingKey: 'multi_delete', name: 'Fitur Hapus Masal (Multi-Delete)', description: 'Mengaktifkan kotak centang (checkbox) pada tabel laporan admin untuk menghapus banyak data sekaligus (Sementara / Permanen).', isActive: false, branches: [] });
    }
  }
};
initSettings();

// SCHEMA HARGA MODAL KHUSUS PASAR SENEN
const modalSenenSchema = new mongoose.Schema({
  itemId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  hargaModal: { type: Number, default: 0 }
}, { timestamps: true });
const ModalSenen = mongoose.model('ModalSenen', modalSenenSchema);

// API HARGA MODAL PASAR SENEN
app.get('/api/modal-senen', async (req, res) => {
  try {
    const data = await ModalSenen.find();
    res.status(200).json(data);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/modal-senen', async (req, res) => {
  try {
    const { items } = req.body;
    // Update massal harga modal (Upsert: kalau gak ada dibikin, kalau ada diupdate)
    const bulkOps = items.map(item => ({
      updateOne: {
        filter: { itemId: item.id },
        update: { itemId: item.id, name: item.name, hargaModal: item.hargaModal },
        upsert: true
      }
    }));
    await ModalSenen.bulkWrite(bulkOps);
    res.status(200).json({ status: 'success' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ... (Di bawah schema Transaction & Recurring)

// 4. SCHEMA MENU MASTER (UNTUK NAMA, HARGA, STOK)
const menuMasterSchema = new mongoose.Schema({
  sheet: { type: String, required: true, index: true },
  menuId: { type: String, required: true },
  name: { type: String, required: true },
  price: { type: Number, required: true },
  stock: { type: Number, default: 0 },
  lastUpdatedDate: { type: String, required: true }, // Format: YYYY-MM-DD
  lastRestockTime: { type: String, default: "" } // <-- FITUR BARU: JAM RESTOK
}, { timestamps: true });
const MenuMaster = mongoose.model('MenuMaster', menuMasterSchema);

// 6. SCHEMA PROGRESS ITEM (AUTO-BACKUP HARIAN)
const progressItemSchema = new mongoose.Schema({
  sheet: { type: String, required: true, index: true },
  tanggal: { type: String, required: true, index: true },
  dataGroups: { type: Array, default: [] },
  grandTotals: { type: Object, default: {} },
  lastSync: { type: String, default: "" }
}, { timestamps: true });
const ProgressItem = mongoose.model('ProgressItem', progressItemSchema);
// 5. SCHEMA ACTIVITY LOG (SUPER DETAIL)
const activityLogSchema = new mongoose.Schema({
  sheet: { type: String, required: true, index: true },
  actionCategory: { type: String, required: true }, // 'UBAH_NAMA', 'UBAH_HARGA', 'UBAH_STOK', 'INFO_STOK'
  menuName: { type: String, required: true },
  detailAction: { type: String, required: true }, // Cth: "Mengubah harga dari Rp 10.000 menjadi Rp 15.000"
  timestamp: { type: String, required: true }, // Jam realtime "15:00:01"
  dateString: { type: String, required: true }, // "Selasa, 01 Januari 2026"
  isDeleted: { type: Boolean, default: false }
}, { timestamps: true });
const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);

// ==========================================
// API ACTIVITY LOG (LAPORAN LAINNYA)
// ==========================================
app.get('/api/activities', async (req, res) => {
  try {
    const data = await ActivityLog.find().sort({ createdAt: -1 });
    res.status(200).json(data);
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.post('/api/activities', async (req, res) => {
  try {
    const newLog = new ActivityLog(req.body);
    await newLog.save();
    res.status(201).json({ status: 'success', data: newLog });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// --- 1. API HAPUS MASSAL (BULK) HARUS PALING ATAS! ---
app.delete('/api/activities/bulk', async (req, res) => {
  try {
    const { ids, isHardDelete } = req.body;
    if (!ids || ids.length === 0) return res.status(400).json({ status: 'error', message: 'Tidak ada data log dipilih' });

    if (isHardDelete) {
      await ActivityLog.deleteMany({ _id: { $in: ids } });
    } else {
      await ActivityLog.updateMany({ _id: { $in: ids } }, { $set: { isDeleted: true } });
    }
    res.status(200).json({ status: 'success', message: 'Log massal berhasil dihapus' });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// --- 2. HARD DELETE (PERMANENT) SATUAN ---
app.delete('/api/activities/hard/:id', async (req, res) => {
  try {
    await ActivityLog.findByIdAndDelete(req.params.id);
    res.status(200).json({ status: 'success', message: 'Log dihapus permanen' });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// --- 3. SOFT DELETE (SATUAN) TARUH PALING BAWAH! ---
app.delete('/api/activities/:id', async (req, res) => {
  try {
    const updated = await ActivityLog.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    res.status(200).json({ status: 'success', data: updated });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// ==========================================
// API EMERGENCY SYSTEM (+ TELEGRAM BOT ALERT)
// ==========================================

// GANTI DENGAN TOKEN & CHAT ID LU!
const TELEGRAM_BOT_TOKEN = '8794940131:AAFLrlwwxwuTi6u8mU-oVQ27oINhn8L3xAc'; 
const TELEGRAM_CHAT_ID = '7971542755';

app.get('/api/emergency/active', async (req, res) => {
  try {
    const data = await Emergency.find({ status: 'ACTIVE' }).sort({ createdAt: -1 });
    res.status(200).json(data);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/emergency', async (req, res) => {
  try {
    const newEmergency = new Emergency(req.body);
    await newEmergency.save();

// --- FITUR BARU: TEMBAK NOTIFIKASI KE TELEGRAM DEDE ---
    if (TELEGRAM_BOT_TOKEN !== '8794940131:AAFLrlwwxwuTi6u8mU-oVQ27oINhn8L3xAc') {
      const pesanTelegram = `🚨 *PANGGILAN DARURAT KASIR!* 🚨\n\n📍 *Cabang:* ${req.body.sheet}\n⏰ *Waktu:* ${req.body.timestamp}\n💬 *Pesan:* ${req.body.message || 'Sistem Error / Butuh Bantuan'}\n\nSegera cek Dashboard Admin lu bos!`;
      
      const telegramUrl = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
      
      try {
        // TAMBAHIN AWAIT DI SINI BOS! Biar Vercel nungguin sampai sukses terkirim.
        await fetch(telegramUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: TELEGRAM_CHAT_ID,
            text: pesanTelegram,
            parse_mode: 'Markdown'
          })
        });
      } catch (err) {
        console.error('Gagal kirim Telegram:', err);
      }
    }
    // --------------------------------------------------------

    // Pastikan res.status ini ada DI BAWAH blok Telegram di atas
    res.status(201).json({ status: 'success', data: newEmergency });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/emergency/solve/:id', async (req, res) => {
  try {
    await Emergency.findByIdAndUpdate(req.params.id, { status: 'SOLVED' });
    res.status(200).json({ status: 'success', message: 'Masalah Selesai' });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// API TRANSAKSI 
// ==========================================
app.get('/api/transactions', async (req, res) => {
  try {
    const { sheet, tanggal } = req.query; // <-- Tangkap query tanggal
    
    let filter = {};
    if (sheet) filter.sheet = sheet;
    if (tanggal) filter.tanggal = tanggal; // <-- Filter berdasarkan tanggal HARI INI saja

    // Kalau ada tanggal (kasir), limit data biar HP ga meledak.
    const query = Transaction.find(filter).sort({ createdAt: 1 });
    if (tanggal) query.limit(500); 

    const data = await query.exec();
    res.status(200).json(data);
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.post('/api/transactions', async (req, res) => {
  try {
    if (Array.isArray(req.body)) {
      const inserted = await Transaction.insertMany(req.body);
      return res.status(201).json({ status: 'success', data: inserted });
    }
    const newTransaction = new Transaction(req.body);
    await newTransaction.save();
    res.status(201).json({ status: 'success', data: newTransaction });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// 1. MULTI-DELETE (HAPUS MASSAL) HARUS DI ATAS!
app.delete('/api/transactions/bulk', async (req, res) => {
  try {
    const { ids, isHardDelete } = req.body;
    if (!ids || ids.length === 0) return res.status(400).json({ status: 'error', message: 'Tidak ada data dipilih' });

    if (isHardDelete) {
      await Transaction.deleteMany({ _id: { $in: ids } });
    } else {
      await Transaction.updateMany({ _id: { $in: ids } }, { $set: { isDeleted: true, deletedAt: new Date() } });
    }
    res.status(200).json({ status: 'success', message: 'Data massal berhasil dihapus' });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// 2. HARD DELETE (PERMANENT)
app.delete('/api/transactions/hard/:id', async (req, res) => {
  try {
    await Transaction.findByIdAndDelete(req.params.id);
    res.status(200).json({ status: 'success', message: 'Data dihapus permanen!' });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// 3. SOFT DELETE (SATUAN) PALING BAWAH
app.delete('/api/transactions/:id', async (req, res) => {
  try {
    const updatedTx = await Transaction.findByIdAndUpdate(req.params.id, { isDeleted: true, deletedAt: new Date() }, { new: true });
    res.status(200).json({ status: 'success', data: updatedTx });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.patch('/api/transactions/:id/print', async (req, res) => {
  try {
    const tx = await Transaction.findById(req.params.id);
    if (!tx) return res.status(404).json({ status: 'error', message: 'Data tidak ditemukan' });
    tx.printCount += 1;
    await tx.save();
    res.status(200).json({ status: 'success', printCount: tx.printCount });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// ==========================================
// API BIAYA ROUTINE
// ==========================================
app.get('/api/recurring', async (req, res) => {
  try {
    const data = await Recurring.find().sort({ createdAt: -1 });
    res.status(200).json(data);
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.post('/api/recurring', async (req, res) => {
  try {
    const newRec = new Recurring(req.body);
    await newRec.save();
    res.status(201).json({ status: 'success', data: newRec });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.delete('/api/recurring/:id', async (req, res) => {
  try {
    await Recurring.findByIdAndDelete(req.params.id);
    res.status(200).json({ status: 'success', message: 'Routine deleted' });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.post('/api/recurring/trigger', async (req, res) => {
  try {
    const rules = await Recurring.find({ isActive: true });
    const today = new Date();
    let generatedCount = 0;
    const daysMap = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
    const monthsMap = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];

    for (const rule of rules) {
      let currentDate = rule.lastApplied ? new Date(rule.lastApplied) : new Date(rule.startDate);
      if (rule.lastApplied) {
        if (rule.frekuensi === 'bulanan') currentDate.setMonth(currentDate.getMonth() + 1);
        else if (rule.frekuensi === 'tahunan') currentDate.setFullYear(currentDate.getFullYear() + 1);
        else if (rule.frekuensi === 'harian') currentDate.setDate(currentDate.getDate() + rule.intervalHari);
      }

      while (currentDate <= today) {
        if (rule.endDate && currentDate > new Date(rule.endDate)) {
           rule.isActive = false; await rule.save(); break;
        }

        const tglFormat = `${daysMap[currentDate.getDay()]}, ${String(currentDate.getDate()).padStart(2, '0')} ${monthsMap[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
        await Transaction.create({ sheet: rule.sheet, tanggal: tglFormat, cash: 0, bca: 0, gofood: 0, jenisPengeluaran: `[OPERASIONAL ROUTINE] ${rule.nama}`, totalPengeluaran: rule.nominal });

        rule.lastApplied = new Date(currentDate); 
        await rule.save();
        generatedCount++;

        if (rule.frekuensi === 'bulanan') currentDate.setMonth(currentDate.getMonth() + 1);
        else if (rule.frekuensi === 'tahunan') currentDate.setFullYear(currentDate.getFullYear() + 1);
        else if (rule.frekuensi === 'harian') currentDate.setDate(currentDate.getDate() + rule.intervalHari);
      }
    }
    res.status(200).json({ status: 'success', generated: generatedCount });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// ==========================================
// API SETTINGS
// ==========================================
app.get('/api/settings', async (req, res) => {
  try {
    const data = await Setting.find();
    res.status(200).json(data);
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

app.put('/api/settings/:id', async (req, res) => {
  try {
    const updated = await Setting.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.status(200).json({ status: 'success', data: updated });
  } catch (error) { res.status(500).json({ status: 'error', message: error.message }); }
});

// ==========================================
// API MENU MASTER & STOCK MANAGEMENT
// ==========================================

// --- HELPER WAKTU ANTI-MELESET (FORCE WIB / ASIA/JAKARTA) ---
const getIndoDateString = (dateObj) => {
    return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta',
        weekday: 'long', 
        day: '2-digit', 
        month: 'long', 
        year: 'numeric'
    }).format(dateObj);
};

const getIndoTimeString = (dateObj, withSeconds = false) => {
    const opts = { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hour12: false };
    if (withSeconds) opts.second = '2-digit';
    return new Intl.DateTimeFormat('id-ID', opts).format(dateObj).replace(/\./g, ':');
};

const getWibTodayDate = () => {
    // Menghasilkan format YYYY-MM-DD mutlak di zona waktu WIB
    return new Intl.DateTimeFormat('en-CA', { 
        timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' 
    }).format(new Date());
};

app.get('/api/menu', async (req, res) => {
  try {
    const { sheet } = req.query;
    if (!sheet) return res.status(400).json({ error: 'Sheet diperlukan' });

    const todayDate = getWibTodayDate(); // Pakai helper WIB
    const menus = await MenuMaster.find({ sheet });

    let updatedMenus = [];

    // LOGIKA AUTO-RESET (Lazy Evaluation)
    for (let menu of menus) {
      if (menu.lastUpdatedDate !== todayDate) {
        // TANGGAL BERBEDA! Berarti ganti hari. Catat sisa stok kemarin ke laporan!
        let detailSisa = `SISA STOK KEMARIN: Tersisa ${menu.stock} porsi`;

        // Bikin Laporan Sisa Stok pakai tanggal dari database kemarin biar akurat
        await ActivityLog.create({
          sheet: menu.sheet,
          actionCategory: 'INFO_STOK',
          menuName: menu.name,
          detailAction: detailSisa,
          timestamp: '23:59:59', // Dianggap akhir hari kemarin
          dateString: `Rekap Stok Otomatis` 
        });

        // Reset Stok untuk hari ini (GLOBAL STOK)
        menu.stock = 0;
        menu.lastUpdatedDate = todayDate;
        await menu.save();
      }
      updatedMenus.push(menu);
    }

    res.status(200).json(updatedMenus);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

// API UPDATE MENU & STOK (VERSI OPTIMASI SUPER CEPAT)
app.put('/api/menu', async (req, res) => {
  try {
    const { sheet, menuId, name, price, stock } = req.body;
    const todayDate = getWibTodayDate();
    const now = new Date();
    const timeStr = getIndoTimeString(now, true); // Jam:Menit:Detik WIB
    const dateStr = getIndoDateString(now); // Hari, Tanggal WIB

    let menu = await MenuMaster.findOne({ sheet, menuId });
    
    if (!menu) {
      // Jika menu baru, langsung buat
      menu = new MenuMaster({ sheet, menuId, name, price, stock, lastUpdatedDate: todayDate });
      await menu.save();
    } else {
      let logs = [];
      const newStockNum = parseInt(stock) || 0;
      const oldStockNum = menu.stock || 0;

// 1. DETEKSI PERUBAHAN STOK (FOKUS UTAMA)
      if (oldStockNum !== newStockNum) {
          const statusLama = oldStockNum === 0 ? "HABIS (0)" : oldStockNum;
          logs.push({
              sheet,
              actionCategory: 'UBAH_STOK',
              menuName: name,
              detailAction: `MANUAL UPDATE: Mengubah Stok dari [${statusLama}] menjadi [${newStockNum}] porsi.`,
              timestamp: timeStr,
              dateString: dateStr
          });
          menu.stock = newStockNum;
          menu.lastRestockTime = timeStr; // <-- SAVE JAM RESTOK
      }
      
      // 2. DETEKSI PERUBAHAN HARGA
      if (menu.price !== price) {
          const rupiah = (num) => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(num);
          logs.push({ sheet, actionCategory: 'UBAH_HARGA', menuName: name, detailAction: `Ubah Harga: ${rupiah(menu.price)} -> ${rupiah(price)}`, timestamp: timeStr, dateString: dateStr });
          menu.price = price;
      }

      // 3. DETEKSI PERUBAHAN NAMA
      if (menu.name !== name) {
          logs.push({ sheet, actionCategory: 'UBAH_NAMA', menuName: name, detailAction: `Ubah Nama: [${menu.name}] -> [${name}]`, timestamp: timeStr, dateString: dateStr });
          menu.name = name;
      }
      
      menu.lastUpdatedDate = todayDate;

      // Simpan Menu & Log secara paralel agar super cepat
      if (logs.length > 0) {
          await Promise.all([
              menu.save(),
              ActivityLog.insertMany(logs)
          ]);
      } else {
          await menu.save();
      }
    }
    
    res.status(200).json({ status: 'success', data: menu });
  } catch (error) { 
    res.status(500).json({ status: 'error', message: error.message }); 
  }
});

// API KURANGI STOK SAAT CHECKOUT
app.post('/api/menu/deduct', async (req, res) => {
    try {
        const { sheet, cartItems } = req.body;
        const now = new Date();
        const timeStr = getIndoTimeString(now); // Pakai helper WIB
        const dateStr = getIndoDateString(now); // Pakai helper WIB
        
        // PROSES PARALEL PAKAI PROMISE.ALL
        const stockUpdates = cartItems.map(async (item) => {
            let baseId = item.id.split('-')[0]; 
            let menu = await MenuMaster.findOne({ sheet, menuId: baseId });
            if (!menu) return null;

            menu.stock -= item.qty;
            let logEntry = null;
            if (menu.stock <= 0) {
                menu.stock = 0;
                logEntry = { sheet, actionCategory: 'INFO_STOK', menuName: menu.name, detailAction: `STOK HABIS! ${menu.name} habis terjual pada jam ${timeStr}`, timestamp: timeStr, dateString: dateStr };
            }
            await menu.save();
            return logEntry;
        });

        const results = await Promise.all(stockUpdates);
        const logs = results.filter(log => log !== null);

        if (logs.length > 0) await ActivityLog.insertMany(logs);
        
        const emptyStockLogs = logs.map(l => `[LAPORAN SISTEM] ${l.detailAction}`);
        res.status(200).json({ status: 'success', systemMessages: emptyStockLogs });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// API KEMBALIKAN STOK SAAT PESANAN DIHAPUS/DIBATALKAN KASIR
app.post('/api/menu/restore', async (req, res) => {
    try {
        const { sheet, cartItems } = req.body;
        const now = new Date();
        const timeStr = getIndoTimeString(now); // Pakai helper WIB
        const dateStr = getIndoDateString(now); // Pakai helper WIB
        
        // PROSES PARALEL PAKAI PROMISE.ALL
        const restoreUpdates = cartItems.map(async (item) => {
            // Escape special character (kayak "+" di "Nasi Rames +") biar aman di Regex
            const safeName = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // Pencarian kebal huruf besar/kecil (Regex 'i')
            let menu = await MenuMaster.findOne({ sheet, name: new RegExp(`^${safeName}$`, 'i') });
            if (!menu) return null;

            menu.stock += item.qty;
            await menu.save();
            return { sheet, actionCategory: 'INFO_STOK', menuName: menu.name, detailAction: `RESTORE STOK: ${menu.name} dikembalikan ${item.qty} porsi (Batal Pesanan)`, timestamp: timeStr, dateString: dateStr };
        });

        const logs = (await Promise.all(restoreUpdates)).filter(log => log !== null);

        if (logs.length > 0) await ActivityLog.insertMany(logs);
        res.status(200).json({ status: 'success' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// ==========================================
// API PROGRESS ITEM (AUTO SAVE BACKUP)
// ==========================================
app.get('/api/progress', async (req, res) => {
  try {
    const { sheet, tanggal } = req.query;
    const data = await ProgressItem.findOne({ sheet, tanggal });
    res.status(200).json(data);
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/progress', async (req, res) => {
  try {
    const { sheet, tanggal, dataGroups, grandTotals, lastSync } = req.body;
    const updated = await ProgressItem.findOneAndUpdate(
      { sheet, tanggal },
      { dataGroups, grandTotals, lastSync },
      { upsert: true, new: true }
    );
    res.status(200).json({ status: 'success', data: updated });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

const PORT = process.env.PORT || 5000;
if (process.env.NODE_ENV !== 'production') {
  app.listen(PORT, () => console.log(`🚀 Backend nyala di http://localhost:${PORT}`));
}
module.exports = app;
