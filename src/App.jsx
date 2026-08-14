import { useState, useEffect, useMemo } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, writeBatch } from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig";
import { Search, Plus, X, Users, Wallet, Ban, LogOut, Loader2, Lock, Mail, Pencil, History, ShieldCheck, Upload, Trash2, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const NAVY = "#16324F";
const TEAL = "#2A9D8F";
const AMBER = "#E76F51";
const CREAM = "#F6F7F5";
const INK = "#1A1D23";

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  const names = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
};
// Pelanggan dianggap "sudah terdaftar" pada suatu bulan kalau createdMonth-nya <= bulan itu (format YYYY-MM bisa dibandingkan string langsung).
// Pelanggan lama tanpa field createdMonth dianggap sudah ada sejak dulu (selalu masuk hitungan).
const existedInMonth = (customer, monthKeyStr) => !customer.createdMonth || customer.createdMonth <= monthKeyStr;
const lastMonths = (n = 6) => {
  const out = [];
  const d = new Date();
  for (let i = 0; i < n; i++) {
    out.push(monthKey(d));
    d.setMonth(d.getMonth() - 1);
  }
  return out;
};
const rupiah = (n) => "Rp" + Number(n || 0).toLocaleString("id-ID");

// Bangun teks otomatis "Nunggak Agustus" / "Nunggak Agustus dan September" / "Nunggak Agustus, September, dan Oktober"
// dari daftar bulan (format YYYY-MM) yang belum lunas dobel.
const nunggakLabel = (months) => {
  if (!months || months.length === 0) return "";
  const sorted = [...new Set(months)].sort();
  const years = new Set(sorted.map((m) => m.split("-")[0]));
  const names = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  const parts = sorted.map((m) => {
    const [y, mm] = m.split("-");
    const nama = names[parseInt(mm, 10) - 1];
    return years.size > 1 ? `${nama} ${y}` : nama;
  });
  if (parts.length === 1) return `Nunggak ${parts[0]}`;
  if (parts.length === 2) return `Nunggak ${parts[0]} dan ${parts[1]}`;
  return `Nunggak ${parts.slice(0, -1).join(", ")}, dan ${parts[parts.length - 1]}`;
};
// Tambahkan bulan `month` ke rantai tunggakan sesuai aturan:
// - status "belum_dobel" selalu mulai/lanjut rantai (minta dobel bulan depan)
// - status "belum" biasa hanya ikut menambah rantai kalau rantai sudah berjalan (sudah pernah minta dobel sebelumnya)
// - status lunas dobel (isDobel) mereset rantai jadi lunas
// - status bayar normal (cash/transfer/kurang) tanpa dobel TIDAK menghapus maupun menambah rantai — tunggakan lama tetap tercatat sampai dibayar dobel
function nextNunggakState(customer, month, status, isDobel) {
  const current = Array.isArray(customer.nunggakBulan) ? customer.nunggakBulan : [];
  if (isDobel) return { nunggakBulan: [], dendaBulanDepan: false };
  const isUnpaid = status === "belum" || status === "belum_dobel";
  if (isUnpaid && (status === "belum_dobel" || current.length > 0)) {
    const updated = current.includes(month) ? current : [...current, month];
    return { nunggakBulan: updated, dendaBulanDepan: true };
  }
  return { nunggakBulan: current, dendaBulanDepan: customer.dendaBulanDepan || false };
}

const STATUS_LABEL = {
  cash: { label: "Lunas · Cash", color: TEAL, bg: "#E6F4F1" },
  transfer: { label: "Lunas · Transfer", color: NAVY, bg: "#EAF0F6" },
  lunas_dobel: { label: "Lunas · Bayar Dobel", color: "#B0362A", bg: "#FBEAE6" },
  kurang: { label: "Bayar Kurang", color: "#B98900", bg: "#FFF6DD" },
  belum: { label: "Belum Bayar", color: AMBER, bg: "#FBEAE6" },
  belum_dobel: { label: "Belum Bayar (Dobel Bln Depan)", color: "#B0362A", bg: "#FBEAE6" },
};
// Status yang dianggap "lunas/berhasil ditarik" — dipakai untuk hitung total pendapatan, dst.
const isLunasStatus = (status) => status === "cash" || status === "transfer" || status === "lunas_dobel";

// ---------- Auth & profil ----------
function useAuthProfile() {
  const [user, setUser] = useState(undefined); // undefined = loading, null = logged out
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        try {
          const snap = await getDoc(doc(db, "users", u.uid));
          if (snap.exists()) setProfile(snap.data());
          else setError("Akun ini belum didaftarkan sebagai Admin/Penagih. Hubungi admin sistem.");
        } catch {
          setError("Gagal memuat profil akun.");
        }
      } else {
        setProfile(null);
      }
    });
  }, []);

  return { user, profile, error, setError };
}

// ---------- Data pelanggan & pembayaran ----------
function useCustomers() {
  const [customers, setCustomers] = useState([]);
  const [ready, setReady] = useState(false);
  useEffect(() => onSnapshot(collection(db, "customers"), (snap) => {
    setCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setReady(true);
  }), []);
  return { customers, ready };
}

function usePayments(month) {
  const [payments, setPayments] = useState([]);
  useEffect(() => {
    const q = query(collection(db, "payments"), where("month", "==", month));
    return onSnapshot(q, (snap) => setPayments(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [month]);
  return payments;
}

function usePenagihList() {
  const [list, setList] = useState([]);
  useEffect(() => {
    const q = query(collection(db, "users"), where("role", "==", "penagih"));
    return onSnapshot(q, (snap) => setList(snap.docs.map((d) => ({ uid: d.id, ...d.data() }))));
  }, []);
  return list;
}

// Tunggakan sekarang adalah angka manual per pelanggan (field `tunggakan` di dokumen customer),
// diisi/diubah langsung oleh Admin atau Penagih — tidak lagi dihitung otomatis dari riwayat pembayaran.
async function saveTunggakan(customerId, value) {
  await updateDoc(doc(db, "customers", customerId), { tunggakan: Math.max(0, Number(value) || 0) });
}

async function savePaymentRecord({ month, customer, status, keterangan, jumlah, penagihUid, dobel }) {
  const payId = `${month}_${customer.id}`;
  const isDobel = status === "lunas_dobel" || !!dobel;
  const { nunggakBulan, dendaBulanDepan } = nextNunggakState(customer, month, status, isDobel);

  // Keterangan otomatis "Nunggak <bulan>" ditempel di depan, catatan manual penagih (kalau ada) ditambahkan setelahnya.
  const isUnpaid = status === "belum" || status === "belum_dobel";
  const autoLabel = isUnpaid ? nunggakLabel(nunggakBulan) : "";
  const manual = (keterangan || "").trim();
  const finalKeterangan = autoLabel ? (manual ? `${autoLabel} — ${manual}` : autoLabel) : manual;

  await setDoc(doc(db, "payments", payId), {
    month, customerId: customer.id, status, keterangan: finalKeterangan,
    jumlah: jumlah || 0, penagihId: penagihUid, tanggal: new Date().toISOString(),
    dobel: isDobel,
  });

  const current = Array.isArray(customer.nunggakBulan) ? customer.nunggakBulan : [];
  const chainChanged = dendaBulanDepan !== (customer.dendaBulanDepan || false)
    || nunggakBulan.length !== current.length
    || nunggakBulan.some((m) => !current.includes(m));
  if (chainChanged) {
    await updateDoc(doc(db, "customers", customer.id), { dendaBulanDepan, nunggakBulan });
  }
}

// ---------- Editor Tunggakan (manual, bisa diubah Admin & Penagih) ----------
function TunggakanEditor({ customer }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(customer.tunggakan || 0));
  const current = customer.tunggakan || 0;

  const submit = async (e) => {
    e.stopPropagation();
    await saveTunggakan(customer.id, val);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <input type="number" inputMode="numeric" min="0" value={val} onChange={(e) => setVal(e.target.value)}
          className="w-14 border border-gray-200 rounded-lg px-2 py-1 text-xs outline-none" autoFocus />
        <button onClick={submit} className="text-xs font-semibold px-2 py-1 rounded-lg text-white" style={{ background: TEAL }}>OK</button>
        <button onClick={(e) => { e.stopPropagation(); setVal(String(current)); setEditing(false); }} className="text-xs text-gray-400 px-1">Batal</button>
      </div>
    );
  }

  return (
    <button onClick={(e) => { e.stopPropagation(); setEditing(true); }} className="inline-flex">
      {current > 0
        ? <Badge color="#B0362A" bg="#FBEAE6">Nunggak {current}x · Ubah</Badge>
        : <span className="text-xs text-gray-300">Set tunggakan</span>}
    </button>
  );
}

// ---------- Ubah status massal (Off/Isolir) khusus Admin ----------
function parseBulkStatusRows(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Terima paste dari Excel (pemisah TAB) atau ketik manual (pemisah koma/titik koma). Kolom daerah opsional, dipakai untuk membedakan nama yang sama.
      const cols = line.includes("\t") ? line.split("\t") : line.split(/[,;]/);
      const [nama, daerah] = cols.map((c) => (c || "").trim());
      return { nama, daerah: daerah || "" };
    })
    .filter((r) => r.nama);
}

function BulkStatusForm({ onCancel, onImported, customers }) {
  const [text, setText] = useState("");
  const [targetStatus, setTargetStatus] = useState("off");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const rows = useMemo(() => parseBulkStatusRows(text), [text]);

  const matchCustomer = (row) => {
    const candidates = customers.filter((c) => (c.nama || "").toLowerCase().trim() === row.nama.toLowerCase().trim()
      && (!row.daerah || (c.daerah || "").toLowerCase().trim() === row.daerah.toLowerCase().trim()));
    return candidates;
  };

  const preview = useMemo(() => rows.map((r) => ({ ...r, matches: matchCustomer(r) })), [rows, customers]);
  const matched = preview.filter((r) => r.matches.length === 1);
  const notFound = preview.filter((r) => r.matches.length === 0);
  const ambiguous = preview.filter((r) => r.matches.length > 1);

  const doSubmit = async () => {
    if (matched.length === 0) return;
    setSaving(true);
    try {
      const chunks = [];
      for (let i = 0; i < matched.length; i += 400) chunks.push(matched.slice(i, i + 400));
      let count = 0;
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach((r) => {
          batch.update(doc(db, "customers", r.matches[0].id), { status: targetStatus });
          count++;
        });
        await batch.commit();
      }
      setResult({ count, notFound, ambiguous });
    } catch (e) {
      setResult({ error: e.message });
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-6">
      <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold" style={{ color: NAVY }}>Ubah Status Massal</h3>
          <button onClick={onCancel}><X size={18} color="#9CA3AF" /></button>
        </div>

        {!result && (
          <>
            <p className="text-xs text-gray-500 mb-2">
              Tempel nama pelanggan yang mau diubah statusnya, satu per baris. Tambahkan kolom daerah (pisahkan koma/TAB)
              kalau ada nama yang sama di beberapa daerah, biar tidak salah pilih.
            </p>
            <div className="flex gap-2 mb-2">
              {["off", "isolir"].map((s) => (
                <button key={s} onClick={() => setTargetStatus(s)} className="flex-1 text-xs font-medium py-2 rounded-lg border"
                  style={targetStatus === s ? { background: AMBER, color: "white", borderColor: AMBER } : { borderColor: "#E5E7EB", color: "#6B7280" }}>
                  Jadikan {s === "off" ? "Off" : "Isolir"}
                </button>
              ))}
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Contoh (1 pelanggan per baris):\nAgung, PADI\nPGD Wawan, PGD-BOKOR"}
              rows={8}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 outline-none resize-none font-mono"
            />
            <p className="text-xs text-gray-400 mb-1">{rows.length} baris ditempel · <span style={{ color: TEAL }}>{matched.length} cocok</span>
              {notFound.length > 0 && <span style={{ color: "#B0362A" }}> · {notFound.length} tidak ditemukan</span>}
              {ambiguous.length > 0 && <span style={{ color: AMBER }}> · {ambiguous.length} nama ganda (perlu daerah)</span>}
            </p>
            <button onClick={doSubmit} disabled={saving || matched.length === 0}
              className="w-full mt-2 py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-40" style={{ background: TEAL }}>
              {saving ? "Menyimpan..." : `Jadikan ${targetStatus === "off" ? "Off" : "Isolir"} — ${matched.length} Pelanggan`}
            </button>
          </>
        )}

        {result && !result.error && (
          <div className="text-sm">
            <p className="mb-2" style={{ color: TEAL }}>✔ {result.count} pelanggan diubah jadi {targetStatus === "off" ? "Off" : "Isolir"}.</p>
            {result.notFound.length > 0 && (
              <p className="text-xs mb-2" style={{ color: "#B0362A" }}>
                Tidak ditemukan (cek ejaan nama/daerah): {result.notFound.map((r) => r.nama).join(", ")}
              </p>
            )}
            {result.ambiguous.length > 0 && (
              <p className="text-xs mb-3" style={{ color: AMBER }}>
                Nama ganda, dilewati — tambahkan daerah untuk membedakan: {result.ambiguous.map((r) => r.nama).join(", ")}
              </p>
            )}
            <button onClick={onImported} className="w-full py-3 rounded-xl text-white font-semibold text-sm" style={{ background: NAVY }}>Selesai</button>
          </div>
        )}
        {result?.error && (
          <div className="text-sm">
            <p className="mb-3" style={{ color: AMBER }}>Gagal menyimpan: {result.error}</p>
            <button onClick={() => setResult(null)} className="w-full py-3 rounded-xl text-white font-semibold text-sm" style={{ background: NAVY }}>Coba Lagi</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- UI kecil ----------
function Badge({ children, color, bg }) {
  return <span className="text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap" style={{ background: bg, color }}>{children}</span>;
}
function StatCard({ icon: Icon, label, value, sub, accent }) {
  return (
    <div className="rounded-2xl p-4 bg-white shadow-sm border border-gray-100 flex-1 min-w-[140px]">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500">{label}</span>
        <Icon size={16} color={accent || NAVY} />
      </div>
      <div className="text-xl font-bold" style={{ color: NAVY, fontFamily: "'IBM Plex Mono', monospace" }}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}
// Catatan: harga per pelanggan sudah tidak lagi dipatok admin — jumlah pembayaran diketik manual oleh penagih saat entri.

// ---------- Login ----------
function LoginScreen({ error }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [localError, setLocalError] = useState(null);
  const [loading, setLoading] = useState(false);

  const doLogin = async () => {
    setLocalError(null); setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pw);
    } catch (e) {
      setLocalError("Email atau kata sandi salah.");
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-6" style={{ background: CREAM }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-20 h-20 rounded-2xl mx-auto mb-4 flex items-center justify-center shadow-sm overflow-hidden" style={{ background: NAVY }}>
            <img src="/logo.png" alt="Logo" className="w-16 h-16 object-contain" />
          </div>
          <h1 className="text-2xl font-bold" style={{ color: NAVY, fontFamily: "'Sora', sans-serif" }}>Buku Tagihan</h1>
          <p className="text-sm text-gray-500 mt-1">Masuk dengan akun resmi Anda</p>
        </div>
        <div className="rounded-2xl p-5 bg-white border border-gray-200 space-y-3">
          <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3">
            <Mail size={15} color="#9CA3AF" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="flex-1 py-2.5 text-sm outline-none" />
          </div>
          <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-3">
            <Lock size={15} color="#9CA3AF" />
            <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Kata sandi" className="flex-1 py-2.5 text-sm outline-none"
              onKeyDown={(e) => e.key === "Enter" && doLogin()} />
          </div>
          {(localError || error) && <p className="text-xs" style={{ color: AMBER }}>{localError || error}</p>}
          <button onClick={doLogin} disabled={loading || !email || !pw} className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-40" style={{ background: TEAL }}>
            {loading ? "Memproses..." : "Masuk"}
          </button>
        </div>
        <p className="text-xs text-gray-400 text-center mt-4">Belum punya akun? Hubungi Admin untuk dibuatkan.</p>
      </div>
    </div>
  );
}

// ---------- Form tambah/ubah pelanggan (khusus Admin) ----------
function CustomerForm({ onSave, onCancel, onDelete, penagihList, initial }) {
  const [form, setForm] = useState(initial || { nama: "", daerah: "", status: "aktif", penagihId: penagihList[0]?.uid || "", tunggakan: 0 });
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-6">
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold" style={{ color: NAVY }}>{initial ? "Ubah Pelanggan" : "Tambah Pelanggan"}</h3>
          <button onClick={onCancel}><X size={18} color="#9CA3AF" /></button>
        </div>
        <div className="space-y-3">
          <div><label className="text-xs text-gray-500">Nama</label>
            <input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 outline-none focus:border-gray-400" /></div>
          <div><label className="text-xs text-gray-500">Daerah</label>
            <input value={form.daerah} onChange={(e) => setForm({ ...form, daerah: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 outline-none focus:border-gray-400" /></div>
          <p className="text-xs text-gray-400 -mt-1">Jumlah tagihan tidak dipatok di sini — penagih akan mengetik jumlah yang benar-benar dibayar saat entri pembayaran tiap bulan.</p>
          <div><label className="text-xs text-gray-500">Penagih</label>
            <select value={form.penagihId} onChange={(e) => setForm({ ...form, penagihId: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 outline-none focus:border-gray-400">
              {penagihList.map((p) => <option key={p.uid} value={p.uid}>{p.nama}</option>)}
            </select></div>
          <div><label className="text-xs text-gray-500">Status</label>
            <div className="flex gap-2 mt-1">
              {["aktif", "isolir", "off"].map((s) => (
                <button key={s} onClick={() => setForm({ ...form, status: s })} className="flex-1 text-xs font-medium py-2 rounded-lg border"
                  style={form.status === s ? { background: NAVY, color: "white", borderColor: NAVY } : { borderColor: "#E5E7EB", color: "#6B7280" }}>
                  {s === "aktif" ? "Aktif" : s === "isolir" ? "Isolir" : "Off"}
                </button>
              ))}
            </div></div>
          <div><label className="text-xs text-gray-500">Tunggakan (bulan)</label>
            <input type="number" inputMode="numeric" min="0" value={form.tunggakan ?? 0}
              onChange={(e) => setForm({ ...form, tunggakan: Number(e.target.value) })}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 outline-none focus:border-gray-400" />
            <p className="text-xs text-gray-400 mt-1">Diisi manual — tidak lagi otomatis. Sekarang mulai dari 0 untuk semua pelanggan.</p>
          </div>
        </div>
        <button onClick={() => onSave({ ...form, harga: 0, tunggakan: Number(form.tunggakan) || 0 })} disabled={!form.nama || !form.daerah}
          className="w-full mt-5 py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-40" style={{ background: TEAL }}>
          Simpan
        </button>
        {initial && (
          confirmDelete ? (
            <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "#F3C6BE", background: "#FBEAE6" }}>
              <p className="text-xs mb-2" style={{ color: "#B0362A" }}>Hapus <b>{initial.nama}</b> permanen? Riwayat pembayarannya tidak akan ikut terhapus, tapi datanya tidak akan muncul lagi di aplikasi.</p>
              <div className="flex gap-2">
                <button onClick={() => onDelete(initial)} className="flex-1 py-2 rounded-lg text-white text-xs font-semibold" style={{ background: "#B0362A" }}>Ya, Hapus</button>
                <button onClick={() => setConfirmDelete(false)} className="flex-1 py-2 rounded-lg text-xs font-semibold border" style={{ borderColor: "#E5E7EB", color: "#6B7280" }}>Batal</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="w-full mt-2 py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5" style={{ color: "#B0362A" }}>
              <Trash2 size={13} /> Hapus Pelanggan
            </button>
          )
        )}
      </div>
    </div>
  );
}

// ---------- Import massal pelanggan (khusus Admin) ----------
const VALID_IMPORT_STATUS = ["aktif", "off", "isolir"];

function parseBulkRows(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Terima paste dari Excel/Spreadsheet (pemisah TAB) atau ketik manual (pemisah koma/titik koma)
      const cols = line.includes("\t") ? line.split("\t") : line.split(/[,;]/);
      const [nama, daerah, harga, penagihNama, statusRaw] = cols.map((c) => (c || "").trim());
      const statusLower = (statusRaw || "").toLowerCase();
      const status = VALID_IMPORT_STATUS.includes(statusLower) ? statusLower : "aktif";
      return { nama, daerah, harga, penagihNama, status, statusRaw };
    })
    .filter((r) => r.nama && r.daerah);
}

function BulkImportForm({ onCancel, onImported, penagihList }) {
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  const rows = useMemo(() => parseBulkRows(text), [text]);

  const findPenagihUid = (namaPenagih) => {
    if (!namaPenagih) return "";
    const match = penagihList.find((p) => (p.nama || "").toLowerCase().trim() === namaPenagih.toLowerCase().trim());
    return match ? match.uid : "";
  };

  const doImport = async () => {
    if (rows.length === 0) return;
    setSaving(true);
    try {
      // Firestore batch maksimal 500 operasi — pecah jadi beberapa batch kalau lebih banyak
      const chunks = [];
      for (let i = 0; i < rows.length; i += 400) chunks.push(rows.slice(i, i + 400));

      let count = 0;
      const notFoundPenagih = new Set();
      const invalidStatus = new Set();
      const statusCount = { aktif: 0, off: 0, isolir: 0 };
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach((r) => {
          const uid = findPenagihUid(r.penagihNama);
          if (r.penagihNama && !uid) notFoundPenagih.add(r.penagihNama);
          if (r.statusRaw && !VALID_IMPORT_STATUS.includes(r.statusRaw.toLowerCase())) invalidStatus.add(r.statusRaw);
          statusCount[r.status] = (statusCount[r.status] || 0) + 1;
          const ref = doc(collection(db, "customers"));
          batch.set(ref, {
            nama: r.nama,
            daerah: r.daerah,
            harga: 0,
            status: r.status,
            penagihId: uid || "",
            dendaBulanDepan: false,
            nunggakBulan: [],
            tunggakan: 0,
            createdMonth: monthKey(),
          });
          count++;
        });
        await batch.commit();
      }
      setResult({ count, notFoundPenagih: [...notFoundPenagih], invalidStatus: [...invalidStatus], statusCount });
    } catch (e) {
      setResult({ error: e.message });
    }
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-20 flex items-end sm:items-center justify-center bg-black/30 p-0 sm:p-6">
      <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold" style={{ color: NAVY }}>Import Pelanggan Massal</h3>
          <button onClick={onCancel}><X size={18} color="#9CA3AF" /></button>
        </div>

        {!result && (
          <>
            <p className="text-xs text-gray-500 mb-2">
              Tempel data dari Excel/Spreadsheet (kolom: <b>Nama, Daerah, 0, Nama Penagih, Status</b> — kolom ke-3 selalu diisi <b>0</b>,
              karena jumlah tagihan tidak dipatok di sini, penagih akan mengetik sendiri jumlah yang dibayar saat entri tiap bulan).
              Bisa langsung select & copy beberapa baris dari Excel lalu paste di sini. Nama penagih harus sama
              persis dengan nama di daftar penagih (boleh dikosongkan kalau belum mau ditugaskan).
              Kolom <b>Status</b> opsional — isi <b>off</b> atau <b>isolir</b> kalau pelanggan itu memang sudah
              off/isolir sejak awal masuk data; kalau dikosongkan otomatis jadi <b>aktif</b>.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Contoh (1 pelanggan per baris):\nAgung, PADI, 0, bekjah\nPGD Wawan, PGD-BOKOR, 0, mbak nurul, off\nBudi, PADI, 0, bekjah, isolir"}
              rows={8}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 outline-none resize-none font-mono"
            />
            <p className="text-xs text-gray-400 mb-3">
              {rows.length} baris terbaca sebagai pelanggan valid.
              {rows.length > 0 && (() => {
                const off = rows.filter((r) => r.status === "off").length;
                const isolir = rows.filter((r) => r.status === "isolir").length;
                return (off > 0 || isolir > 0) ? ` (Off: ${off}, Isolir: ${isolir})` : "";
              })()}
            </p>
            <button onClick={doImport} disabled={saving || rows.length === 0}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-40" style={{ background: TEAL }}>
              {saving ? "Mengimpor..." : `Import ${rows.length} Pelanggan`}
            </button>
          </>
        )}

        {result && !result.error && (
          <div className="text-sm">
            <p className="mb-2" style={{ color: TEAL }}>✔ Berhasil mengimpor {result.count} pelanggan.</p>
            <p className="text-xs text-gray-500 mb-2">
              Aktif: {result.statusCount.aktif} · Off: {result.statusCount.off} · Isolir: {result.statusCount.isolir}
            </p>
            {result.invalidStatus?.length > 0 && (
              <p className="text-xs mb-3" style={{ color: AMBER }}>
                Catatan: nilai status berikut tidak dikenali (harus aktif/off/isolir), jadi pelanggan itu tetap
                diimpor sebagai <b>aktif</b>: {result.invalidStatus.join(", ")}
              </p>
            )}
            {result.notFoundPenagih.length > 0 && (
              <p className="text-xs mb-3" style={{ color: AMBER }}>
                Catatan: nama penagih berikut tidak ditemukan di daftar penagih, jadi pelanggan itu diimpor tanpa
                penagih (bisa diisi manual belakangan): {result.notFoundPenagih.join(", ")}
              </p>
            )}
            <button onClick={onImported} className="w-full py-3 rounded-xl text-white font-semibold text-sm" style={{ background: NAVY }}>Selesai</button>
          </div>
        )}
        {result?.error && (
          <div className="text-sm">
            <p className="mb-3" style={{ color: AMBER }}>Gagal impor: {result.error}</p>
            <button onClick={() => setResult(null)} className="w-full py-3 rounded-xl text-white font-semibold text-sm" style={{ background: NAVY }}>Coba Lagi</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Panel Admin ----------
function AdminView({ profile, customers, penagihList, onLogout }) {
  const [tab, setTab] = useState("ringkasan");
  const [query, setQuery] = useState("");
  const [daerahFilter, setDaerahFilter] = useState("semua");
  const [statusFilter, setStatusFilter] = useState("semua");
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [showBulkStatus, setShowBulkStatus] = useState(false);
  const [viewMonth, setViewMonth] = useState(monthKey());
  const payments = usePayments(viewMonth);

  const daerahList = useMemo(() => [...new Set(customers.map((c) => c.daerah).filter(Boolean))].sort(), [customers]);
  // Pelanggan yang sudah terdaftar sampai dengan viewMonth — dipakai untuk semua statistik/riwayat bulan itu,
  // supaya pelanggan yang baru masuk bulan-bulan berikutnya tidak ikut terhitung di bulan-bulan sebelumnya.
  const customersForMonth = useMemo(() => customers.filter((c) => existedInMonth(c, viewMonth)), [customers, viewMonth]);
  const paidMap = new Map(payments.map((p) => [p.customerId, p]));
  const lunas = payments.filter((p) => isLunasStatus(p.status));
  const totalCash = payments.filter((p) => p.status === "cash").reduce((s, p) => s + p.jumlah, 0);
  const totalTransfer = payments.filter((p) => p.status === "transfer").reduce((s, p) => s + p.jumlah, 0);
  const totalDobel = payments.filter((p) => p.status === "lunas_dobel").reduce((s, p) => s + p.jumlah, 0);
  const totalKurang = payments.filter((p) => p.status === "kurang").reduce((s, p) => s + p.jumlah, 0);
  const isolirCount = customersForMonth.filter((c) => c.status === "isolir" || c.status === "off").length;
  const aktifCount = customersForMonth.filter((c) => c.status === "aktif").length;
  const belumBayar = customersForMonth.filter((c) => c.status === "aktif" && !paidMap.has(c.id));
  const belumBayarTanpaKet = customersForMonth.filter((c) => {
    if (c.status !== "aktif") return false;
    const pay = paidMap.get(c.id);
    if (!pay) return true; // belum ada catatan sama sekali
    const isBelum = pay.status === "belum" || pay.status === "belum_dobel";
    return isBelum && !(pay.keterangan && pay.keterangan.trim());
  });
  const withCustomer = (p) => ({ ...p, customer: customers.find((c) => c.id === p.customerId) });
  const lunasList = useMemo(() => lunas.map(withCustomer), [lunas, customers]);
  const bayarKurangList = useMemo(() => payments.filter((p) => p.status === "kurang").map(withCustomer), [payments, customers]);
  const dobelList = useMemo(() => payments.filter((p) => p.status === "belum_dobel").map(withCustomer), [payments, customers]);
  const saveRiwayat = (customer, status, keterangan, jumlah, dobel) =>
    savePaymentRecord({ month: viewMonth, customer, status, keterangan, jumlah, penagihUid: customer.penagihId || "", dobel });

  const perDaerah = useMemo(() => [...new Set(customersForMonth.map((c) => c.daerah).filter(Boolean))].sort().map((d) => {
    const cs = customersForMonth.filter((c) => c.daerah === d && c.status === "aktif");
    const paidCs = cs.filter((c) => lunas.some((p) => p.customerId === c.id));
    const uang = lunas.filter((p) => cs.some((c) => c.id === p.customerId)).reduce((s, p) => s + p.jumlah, 0);
    return { daerah: d, total: cs.length, sudahBayar: paidCs.length, uang };
  }), [customersForMonth, lunas]);

  const perPenagih = useMemo(() => penagihList.map((p) => {
    const cs = customersForMonth.filter((c) => c.penagihId === p.uid && c.status === "aktif");
    const penagihLunas = lunas.filter((pay) => pay.penagihId === p.uid);
    const berhasil = penagihLunas.length;
    const dobelCount = penagihLunas.filter((pay) => pay.dobel).length;
    const uang = penagihLunas.reduce((s, pay) => s + pay.jumlah, 0);
    const uangCash = payments.filter((pay) => pay.penagihId === p.uid && pay.status === "cash").reduce((s, pay) => s + pay.jumlah, 0);
    const uangTransfer = payments.filter((pay) => pay.penagihId === p.uid && pay.status === "transfer").reduce((s, pay) => s + pay.jumlah, 0);
    return { ...p, ditugaskan: cs.length, berhasil, dobelCount, uang, uangCash, uangTransfer };
  }), [penagihList, customers, lunas, payments]);

  const filtered = customers
    .filter((c) => (c.nama + c.daerah).toLowerCase().includes(query.toLowerCase()))
    .filter((c) => daerahFilter === "semua" || c.daerah === daerahFilter)
    .filter((c) => statusFilter === "semua" || c.status === statusFilter);

  const saveCustomer = async (c) => {
    if (editing) await updateDoc(doc(db, "customers", editing.id), c);
    else await addDoc(collection(db, "customers"), { ...c, dendaBulanDepan: false, nunggakBulan: [], tunggakan: c.tunggakan || 0, createdMonth: monthKey() });
    setShowForm(false); setEditing(null);
  };
  const deleteCustomer = async (c) => {
    await deleteDoc(doc(db, "customers", c.id));
    setShowForm(false); setEditing(null);
  };

  return (
    <div className="min-h-screen pb-6 relative" style={{ background: CREAM }}>
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: "url(/logo-watermark.png)",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center 40%",
          backgroundSize: "min(80vw, 420px)",
          opacity: 0.06,
        }}
      />
      <div className="px-5 pt-5 pb-4 sticky top-0 z-10 relative overflow-hidden" style={{ background: NAVY }}>
        <img
          src="/logo-small.png"
          alt=""
          className="pointer-events-none absolute -right-6 -top-8 w-36 h-36 object-contain opacity-15"
        />
        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-3">
            <img src="/logo-small.png" alt="Logo" className="w-9 h-9 object-contain" />
            <div>
              <div className="text-white/60 text-xs">Panel Admin · {profile.nama}</div>
              <div className="text-white font-bold text-lg" style={{ fontFamily: "'Sora', sans-serif" }}>Buku Tagihan</div>
            </div>
          </div>
          <button onClick={onLogout} className="text-white/70"><LogOut size={18} /></button>
        </div>
        <div className="flex gap-2 mt-4 overflow-x-auto relative z-10">
          {[["ringkasan","Ringkasan"],["pelanggan","Pelanggan"],["penagih","Kinerja Penagih"],["riwayat","Riwayat Bulan"]].map(([k,label]) => (
            <button key={k} onClick={() => setTab(k)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap"
              style={tab === k ? { background: "white", color: NAVY } : { background: "rgba(255,255,255,0.12)", color: "white" }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="p-5 relative z-10">
        {tab === "ringkasan" && (
          <>
            <div className="flex gap-3 flex-wrap mb-3">
              <StatCard icon={Users} label={`Total Pelanggan ${monthLabel(viewMonth)}`} value={customersForMonth.length} />
              <StatCard icon={ShieldCheck} label="Pelanggan Aktif" value={aktifCount} accent={TEAL} />
              <StatCard icon={Wallet} label={`Pendapatan ${monthLabel(viewMonth)}`} value={rupiah(totalCash + totalTransfer + totalDobel)} accent={TEAL} sub={`${lunas.length} pelanggan lunas`} />
              <StatCard icon={Ban} label="Isolir / Off" value={isolirCount} accent={AMBER} />
            </div>
            <div className="flex gap-3 flex-wrap mb-3">
              <StatCard icon={Wallet} label="Total Cash" value={rupiah(totalCash)} accent={TEAL} sub={`${payments.filter((p) => p.status === "cash").length} pelanggan`} />
              <StatCard icon={Wallet} label="Total Transfer" value={rupiah(totalTransfer)} accent={NAVY} sub={`${payments.filter((p) => p.status === "transfer").length} pelanggan`} />
              <StatCard icon={Wallet} label="Total Bayar Dobel" value={rupiah(totalDobel)} accent="#B0362A" sub={`${payments.filter((p) => p.status === "lunas_dobel").length} pelanggan`} />
            </div>
            <div className="rounded-2xl bg-white border border-gray-100 p-4 mb-3">
              <div className="font-semibold text-sm mb-3" style={{ color: NAVY }}>Rincian per Daerah</div>
              <div className="space-y-2">
                {perDaerah.map((d) => (
                  <div key={d.daerah} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                    <span style={{ color: INK }}>{d.daerah}</span>
                    <span className="text-xs text-gray-400">{d.sudahBayar}/{d.total} bayar</span>
                    <span className="font-mono text-xs font-semibold" style={{ color: TEAL }}>{rupiah(d.uang)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-2xl bg-white border border-gray-100 p-4">
              <div className="font-semibold text-sm mb-3" style={{ color: NAVY }}>Belum bayar bulan ini ({belumBayar.length})</div>
              {belumBayar.slice(0, 8).map((c) => (
                <div key={c.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div><div className="text-sm font-medium flex items-center gap-1.5" style={{ color: INK }}>{c.nama}<TunggakanEditor customer={c} /></div><div className="text-xs text-gray-400">{c.daerah}</div></div>
                </div>
              ))}
              {belumBayar.length === 0 && <p className="text-xs text-gray-400">Semua pelanggan aktif sudah bayar bulan ini.</p>}
            </div>
            <div className="rounded-2xl bg-white border border-gray-100 p-4 mt-3">
              <div className="font-semibold text-sm mb-1" style={{ color: NAVY }}>Belum bayar & tanpa keterangan ({belumBayarTanpaKet.length})</div>
              <p className="text-xs text-gray-400 mb-3">Pelanggan yang belum bayar dan penagihnya belum mengisi catatan/alasan — perlu ditindaklanjuti.</p>
              {belumBayarTanpaKet.map((c) => {
                const p = penagihList.find((pp) => pp.uid === c.penagihId);
                return (
                  <div key={c.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                    <div><div className="text-sm font-medium flex items-center gap-1.5" style={{ color: INK }}>{c.nama}<TunggakanEditor customer={c} /></div><div className="text-xs text-gray-400">{c.daerah} · Penagih: {p?.nama || "-"}</div></div>
                  </div>
                );
              })}
              {belumBayarTanpaKet.length === 0 && <p className="text-xs text-gray-400">Semua pelanggan yang belum bayar sudah punya keterangan.</p>}
            </div>
          </>
        )}

        {tab === "pelanggan" && (
          <>
            <div className="flex gap-2 mb-3">
              <div className="flex-1 flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3">
                <Search size={15} color="#9CA3AF" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama / daerah" className="flex-1 py-2.5 text-sm outline-none" />
              </div>
              <button onClick={() => { setEditing(null); setShowForm(true); }} className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ background: TEAL }}><Plus size={18} /></button>
              <button onClick={() => setShowBulkImport(true)} className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ background: NAVY }} title="Import massal dari Excel"><Upload size={18} /></button>
              <button onClick={() => setShowBulkStatus(true)} className="w-10 h-10 rounded-xl flex items-center justify-center text-white" style={{ background: AMBER }} title="Ubah status massal (Off/Isolir)"><Ban size={18} /></button>
            </div>
            <div className="flex gap-2 mb-3 overflow-x-auto">
              <button onClick={() => setDaerahFilter("semua")} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border"
                style={daerahFilter === "semua" ? { background: NAVY, color: "white", borderColor: NAVY } : { borderColor: "#E5E7EB", color: "#6B7280" }}>Semua daerah</button>
              {daerahList.map((d) => (
                <button key={d} onClick={() => setDaerahFilter(d)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border"
                  style={daerahFilter === d ? { background: NAVY, color: "white", borderColor: NAVY } : { borderColor: "#E5E7EB", color: "#6B7280" }}>{d}</button>
              ))}
            </div>
            <div className="flex gap-2 mb-3 overflow-x-auto">
              {[["semua","Semua status"],["aktif","Aktif"],["isolir","Isolir"],["off","Off"]].map(([k,label]) => (
                <button key={k} onClick={() => setStatusFilter(k)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border"
                  style={statusFilter === k ? { background: AMBER, color: "white", borderColor: AMBER } : { borderColor: "#E5E7EB", color: "#6B7280" }}>{label}</button>
              ))}
            </div>
            <div className="space-y-2">
              {filtered.map((c) => {
                const pay = paidMap.get(c.id);
                const st = pay ? STATUS_LABEL[pay.status] : null;
                return (
                  <button key={c.id} onClick={() => { setEditing(c); setShowForm(true); }} className="w-full text-left rounded-xl bg-white border border-gray-100 p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: INK }}>{c.nama} <Pencil size={11} color="#C4C9D2" /><TunggakanEditor customer={c} /></div>
                        <div className="text-xs text-gray-400">{c.daerah}{(c.nunggakBulan?.length > 0 || c.dendaBulanDepan) && <span style={{ color: AMBER }}> · {c.nunggakBulan?.length > 0 ? nunggakLabel(c.nunggakBulan) : "Dobel bulan depan"}</span>}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {c.status !== "aktif" && <Badge color={AMBER} bg="#FBEAE6">{c.status === "isolir" ? "Isolir" : "Off"}</Badge>}
                        {st && <Badge color={st.color} bg={st.bg}>{st.label}</Badge>}
                      </div>
                    </div>
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="text-xs text-gray-400 text-center py-6">Tidak ada pelanggan ditemukan.</p>}
            </div>
          </>
        )}

        {tab === "penagih" && (
          <div className="space-y-2">
            {perPenagih.map((p) => (
              <div key={p.uid} className="rounded-xl bg-white border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium" style={{ color: INK }}>{p.nama}</div>
                  <div className="text-xs text-gray-400">{p.ditugaskan} pelanggan ditugaskan</div>
                </div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400">Berhasil ditarik bulan ini</span>
                  <span className="font-mono font-semibold" style={{ color: TEAL }}>{p.berhasil} pelanggan</span>
                </div>
                {p.dobelCount > 0 && (
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span style={{ color: "#B0362A" }}>Termasuk bayar dobel</span>
                    <span className="font-mono font-semibold" style={{ color: "#B0362A" }}>{p.dobelCount} pelanggan</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400">Cash</span>
                  <span className="font-mono font-semibold" style={{ color: TEAL }}>{rupiah(p.uangCash)}</span>
                </div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400">Transfer</span>
                  <span className="font-mono font-semibold" style={{ color: NAVY }}>{rupiah(p.uangTransfer)}</span>
                </div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-gray-400">Total uang dikumpulkan</span>
                  <span className="font-mono font-semibold" style={{ color: NAVY }}>{rupiah(p.uang)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "riwayat" && (
          <>
            <div className="flex items-center gap-2 mb-4">
              <History size={15} color={NAVY} />
              <select value={viewMonth} onChange={(e) => setViewMonth(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none">
                {lastMonths(12).map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            <div className="flex gap-3 flex-wrap mb-3">
              <StatCard icon={Wallet} label={`Pendapatan ${monthLabel(viewMonth)}`} value={rupiah(totalCash + totalTransfer + totalDobel)} accent={TEAL} />
              <StatCard icon={Users} label="Lunas" value={`${lunas.length}/${customersForMonth.length}`} />
            </div>
            <div className="flex gap-3 flex-wrap mb-3">
              <StatCard icon={Wallet} label="Total Cash" value={rupiah(totalCash)} accent={TEAL} />
              <StatCard icon={Wallet} label="Total Transfer" value={rupiah(totalTransfer)} accent={NAVY} />
              <StatCard icon={Wallet} label="Total Bayar Dobel" value={rupiah(totalDobel)} accent="#B0362A" />
              <StatCard icon={Wallet} label="Total Kurang Bayar" value={rupiah(totalKurang)} accent="#B98900" />
            </div>
            <div className="rounded-2xl bg-white border border-gray-100 p-4 mb-3">
              <div className="font-semibold text-sm mb-3" style={{ color: NAVY }}>Rincian per Daerah — {monthLabel(viewMonth)}</div>
              {perDaerah.map((d) => (
                <div key={d.daerah} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                  <span style={{ color: INK }}>{d.daerah}</span>
                  <span className="text-xs text-gray-400">{d.sudahBayar}/{d.total} bayar</span>
                  <span className="font-mono text-xs font-semibold" style={{ color: TEAL }}>{rupiah(d.uang)}</span>
                </div>
              ))}
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 p-4 mb-3">
              <div className="font-semibold text-sm mb-3" style={{ color: TEAL }}>Bayar Pas / Lunas ({lunasList.length})</div>
              {lunasList.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: INK }}>
                      {p.customer?.nama || "-"}
                      {p.dobel && <Badge color="#B0362A" bg="#FBEAE6">Dobel</Badge>}
                    </div>
                    <div className="text-xs text-gray-400">{p.customer?.daerah}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs font-mono font-semibold" style={{ color: TEAL }}>{rupiah(p.jumlah)}</div>
                    <div className="text-xs text-gray-400">{p.status === "cash" ? "Cash" : p.status === "transfer" ? "Transfer" : "Bayar Dobel"}</div>
                  </div>
                </div>
              ))}
              {lunasList.length === 0 && <p className="text-xs text-gray-400">Belum ada yang lunas bulan ini.</p>}
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 p-4 mb-3">
              <div className="font-semibold text-sm mb-1" style={{ color: "#B98900" }}>Bayar Kurang ({bayarKurangList.length})</div>
              <p className="text-xs text-gray-400 mb-3">Pelanggan yang sudah bayar tapi belum penuh.</p>
              {bayarKurangList.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div>
                    <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: INK }}>{p.customer?.nama || "-"}{p.customer && <TunggakanEditor customer={p.customer} />}</div>
                    <div className="text-xs text-gray-400">{p.customer?.daerah}{p.keterangan && <> · "{p.keterangan}"</>}</div>
                  </div>
                  <div className="text-xs font-mono font-semibold" style={{ color: "#B98900" }}>{rupiah(p.jumlah)}</div>
                </div>
              ))}
              {bayarKurangList.length === 0 && <p className="text-xs text-gray-400">Tidak ada pelanggan yang bayar kurang bulan ini.</p>}
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 p-4 mb-3">
              <div className="font-semibold text-sm mb-1" style={{ color: "#B0362A" }}>Akan Ditagih Dobel Bulan Depan ({dobelList.length})</div>
              {dobelList.map((p) => (
                <div key={p.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                  <div><div className="text-sm font-medium" style={{ color: INK }}>{p.customer?.nama || "-"}</div><div className="text-xs text-gray-400">{p.customer?.daerah}{p.keterangan && <> · "{p.keterangan}"</>}</div></div>
                </div>
              ))}
              {dobelList.length === 0 && <p className="text-xs text-gray-400">Tidak ada.</p>}
            </div>

            <div className="rounded-2xl bg-white border border-gray-100 p-4 mb-3">
              <div className="font-semibold text-sm mb-1" style={{ color: AMBER }}>Belum Bayar & Tanpa Keterangan ({belumBayarTanpaKet.length})</div>
              <p className="text-xs text-gray-400 mb-3">Bisa langsung dicatat di sini kalau ternyata pelanggan ini bayar belakangan — termasuk untuk bulan yang sudah lewat.</p>
              <div className="space-y-2">
                {belumBayarTanpaKet.map((c) => <PayRow key={c.id} customer={c} existing={paidMap.get(c.id)} onSave={saveRiwayat} month={viewMonth} />)}
                {belumBayarTanpaKet.length === 0 && <p className="text-xs text-gray-400">Semua pelanggan yang belum bayar sudah punya keterangan.</p>}
              </div>
            </div>

            <p className="text-xs text-gray-400 mt-3">Data bulan-bulan sebelumnya tersimpan permanen dan tidak pernah terhapus — setiap bulan baru otomatis mulai kosong tanpa menghapus riwayat.</p>
          </>
        )}
      </div>

      {showForm && <CustomerForm initial={editing} penagihList={penagihList} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={saveCustomer} onDelete={deleteCustomer} />}
      {showBulkImport && (
        <BulkImportForm
          penagihList={penagihList}
          onCancel={() => setShowBulkImport(false)}
          onImported={() => setShowBulkImport(false)}
        />
      )}
      {showBulkStatus && (
        <BulkStatusForm
          customers={customers}
          onCancel={() => setShowBulkStatus(false)}
          onImported={() => setShowBulkStatus(false)}
        />
      )}
    </div>
  );
}

// ---------- Panel Penagih ----------
function PayRow({ customer, existing, onSave, month }) {
  const [editingRow, setEditingRow] = useState(!existing);
  const [status, setStatus] = useState(existing?.status || "");
  const [keterangan, setKeterangan] = useState(existing?.keterangan || "");
  const [jumlah, setJumlah] = useState(existing?.jumlah ? String(existing.jumlah) : "");
  const needsJumlah = status === "cash" || status === "transfer" || status === "kurang" || status === "lunas_dobel";
  // Preview keterangan otomatis "Nunggak ..." berdasarkan rantai tunggakan pelanggan, dihitung ulang tiap status berubah.
  const previewChain = month ? nextNunggakState(customer, month, status, status === "lunas_dobel") : null;
  const previewLabel = previewChain && (status === "belum" || status === "belum_dobel") ? nunggakLabel(previewChain.nunggakBulan) : "";

  const submit = () => {
    if (!status) return;
    const jml = needsJumlah ? Number(jumlah) || 0 : 0;
    onSave(customer, status, keterangan, jml);
    setEditingRow(false);
  };

  if (!editingRow && existing) {
    const st = STATUS_LABEL[existing.status];
    const isPaid = isLunasStatus(existing.status);
    return (
      <div className="rounded-xl bg-white border border-gray-100 p-3" style={{ borderLeft: `4px solid ${st?.color || AMBER}` }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: INK }}>
              {isPaid && <CheckCircle2 size={14} color={TEAL} />}
              {customer.nama}<TunggakanEditor customer={customer} />
            </div>
            <div className="text-xs text-gray-400">{customer.daerah}{existing.jumlah > 0 && <> · {rupiah(existing.jumlah)}</>}</div>
            {existing.keterangan && <div className="text-xs text-gray-400 italic mt-1">"{existing.keterangan}"</div>}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge color={st.color} bg={st.bg}>{st.label}</Badge>
            <button onClick={() => setEditingRow(true)} className="text-xs" style={{ color: NAVY }}>Ubah</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white border border-gray-100 p-3" style={{ borderLeft: `4px solid ${existing ? (STATUS_LABEL[existing.status]?.color || TEAL) : "#D1D5DB"}` }}>
      <div className="text-sm font-medium flex items-center gap-1.5" style={{ color: INK }}>
        {customer.nama} {customer.status !== "aktif" && <Badge color={AMBER} bg="#FBEAE6">{customer.status}</Badge>}
        <TunggakanEditor customer={customer} />
      </div>
      <div className="text-xs text-gray-400 mb-2">{customer.daerah}{(customer.nunggakBulan?.length > 0 || customer.dendaBulanDepan) && <span style={{ color: "#B0362A" }}> · {customer.nunggakBulan?.length > 0 ? nunggakLabel(customer.nunggakBulan) : "Minta dobel (tunggakan bulan lalu)"}</span>}</div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 outline-none">
        <option value="">Pilih status bayar...</option>
        <option value="cash">Lunas · Cash</option>
        <option value="transfer">Lunas · Transfer</option>
        {customer.dendaBulanDepan && <option value="lunas_dobel">Lunas · Bayar Dobel</option>}
        <option value="kurang">Bayar Kurang / Sebagian</option>
        <option value="belum">Belum Bayar</option>
        <option value="belum_dobel">Belum Bayar — Dobel Bulan Depan</option>
      </select>
      {status === "lunas_dobel" && (
        <p className="text-xs mb-2 p-2 rounded-lg" style={{ background: "#FBEAE6", color: "#B0362A" }}>
          Isi jumlah total yang dibayar (bulan ini + tunggakan bulan lalu). Tunggakan akan dianggap lunas.
        </p>
      )}
      {previewLabel && (
        <p className="text-xs mb-2 p-2 rounded-lg" style={{ background: "#FBEAE6", color: "#B0362A" }}>
          Keterangan otomatis: <b>{previewLabel}</b>
        </p>
      )}
      {needsJumlah && (
        <input type="text" inputMode="numeric" value={jumlah}
          onChange={(e) => setJumlah(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="Jumlah dibayar (contoh: 110000 atau 110.000)"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 outline-none" />
      )}
      <textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="Keterangan (opsional)" rows={2}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 outline-none resize-none" />
      <div className="flex gap-2">
        {existing && <button onClick={() => setEditingRow(false)} className="flex-1 text-xs font-medium py-2 rounded-lg border border-gray-200 text-gray-500">Batal</button>}
        <button onClick={submit} disabled={!status || (needsJumlah && !jumlah)} className="flex-1 text-xs font-semibold py-2 rounded-lg text-white disabled:opacity-40" style={{ background: TEAL }}>Simpan</button>
      </div>
    </div>
  );
}

function PenagihView({ profile, uid, customers, onLogout }) {
  const [entryMonth, setEntryMonth] = useState(monthKey());
  const [showDetail, setShowDetail] = useState(false);
  const payments = usePayments(entryMonth);
  const [query, setQuery] = useState("");
  const [daerahFilter, setDaerahFilter] = useState("semua");
  const [bayarFilter, setBayarFilter] = useState("semua");
  const mine = customers.filter((c) => c.penagihId === uid && c.status === "aktif" && existedInMonth(c, entryMonth));
  const nonAktif = customers.filter((c) => c.penagihId === uid && c.status !== "aktif" && existedInMonth(c, entryMonth));
  const daerahList = useMemo(() => [...new Set(mine.map((c) => c.daerah).filter(Boolean))].sort(), [mine]);
  const paidMap = new Map(payments.filter((p) => p.penagihId === uid).map((p) => [p.customerId, p]));
  const filtered = mine
    .filter((c) => (c.nama + c.daerah).toLowerCase().includes(query.toLowerCase()))
    .filter((c) => daerahFilter === "semua" || c.daerah === daerahFilter)
    .filter((c) => {
      if (bayarFilter === "semua") return true;
      if (bayarFilter === "sudah") return isLunasStatus(paidMap.get(c.id)?.status);
      if (bayarFilter === "belum") return !isLunasStatus(paidMap.get(c.id)?.status);
      if (bayarFilter === "dobel") return !!c.dendaBulanDepan;
      if (bayarFilter === "dobel_lunas") return paidMap.get(c.id)?.status === "lunas_dobel";
      return true;
    });
  const sudahBayarCount = mine.filter((c) => isLunasStatus(paidMap.get(c.id)?.status)).length;
  const sudahDicatat = sudahBayarCount;
  const mintaDobelCount = mine.filter((c) => c.dendaBulanDepan).length;
  const bayarDobelCount = mine.filter((c) => paidMap.get(c.id)?.status === "lunas_dobel").length;
  const berhasil = mine.filter((c) => { const p = paidMap.get(c.id); return p && isLunasStatus(p.status); }).length;
  const mineCash = [...paidMap.values()].filter((p) => p.status === "cash").reduce((s, p) => s + p.jumlah, 0);
  const mineTransfer = [...paidMap.values()].filter((p) => p.status === "transfer").reduce((s, p) => s + p.jumlah, 0);
  const mineDobel = [...paidMap.values()].filter((p) => p.status === "lunas_dobel").reduce((s, p) => s + p.jumlah, 0);
  const mineKurang = [...paidMap.values()].filter((p) => p.status === "kurang").reduce((s, p) => s + p.jumlah, 0);
  const belumTanpaKet = mine.filter((c) => {
    const p = paidMap.get(c.id);
    if (!p) return true;
    const isBelum = p.status === "belum" || p.status === "belum_dobel";
    return isBelum && !(p.keterangan && p.keterangan.trim());
  });
  const isCurrentMonth = entryMonth === monthKey();

  const save = (customer, status, keterangan, jumlah, dobel) => savePaymentRecord({ month: entryMonth, customer, status, keterangan, jumlah, penagihUid: uid, dobel });

  return (
    <div className="min-h-screen pb-6 relative" style={{ background: CREAM }}>
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          backgroundImage: "url(/logo-watermark.png)",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center 40%",
          backgroundSize: "min(80vw, 420px)",
          opacity: 0.06,
        }}
      />
      <div className="px-5 pt-5 pb-4 sticky top-0 z-10 relative overflow-hidden" style={{ background: NAVY }}>
        <img
          src="/logo-small.png"
          alt=""
          className="pointer-events-none absolute -right-6 -top-8 w-36 h-36 object-contain opacity-15"
        />
        <div className="flex items-center justify-between relative z-10">
          <div className="flex items-center gap-3">
            <img src="/logo-small.png" alt="Logo" className="w-9 h-9 object-contain" />
            <div><div className="text-white/60 text-xs">Buku Tagihan</div><div className="text-white font-bold text-lg" style={{ fontFamily: "'Sora', sans-serif" }}>{profile.nama}</div></div>
          </div>
          <button onClick={onLogout} className="text-white/70"><LogOut size={18} /></button>
        </div>
        <select value={entryMonth} onChange={(e) => setEntryMonth(e.target.value)} className="w-full mt-3 border border-white/20 bg-white/10 text-white rounded-lg px-3 py-2 text-sm outline-none relative z-10">
          {lastMonths(6).map((m) => <option key={m} value={m} style={{ color: INK }}>{monthLabel(m)}{m === monthKey() ? " (bulan ini)" : ""}</option>)}
        </select>
        <button onClick={() => setShowDetail((v) => !v)} className="w-full mt-3 flex items-center justify-between rounded-2xl bg-white/10 p-3 relative z-10">
          <div className="flex items-center gap-4 text-xs text-white/80">
            <span>Tercatat <b className="text-white font-mono">{sudahDicatat}/{mine.length}</b></span>
          </div>
          {showDetail ? <ChevronUp size={16} color="white" /> : <ChevronDown size={16} color="white" />}
        </button>
        {showDetail && (
          <div className="mt-2 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white/10 p-3"><div className="text-white/70 text-xs mb-1">Sudah membayar</div><div className="text-white font-mono font-semibold">{sudahDicatat}/{mine.length}</div></div>
              <div className="rounded-2xl bg-white/10 p-3"><div className="text-white/70 text-xs mb-1">Berhasil ditarik</div><div className="text-white font-mono font-semibold">{berhasil}/{mine.length}</div></div>
            </div>
            {nonAktif.length > 0 && <p className="text-white/50 text-xs">{nonAktif.length} pelanggan isolir/off tidak masuk tugas bulan ini.</p>}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl bg-white/10 p-3"><div className="text-white/70 text-xs mb-1">Cash</div><div className="text-white font-mono font-semibold text-sm">{rupiah(mineCash)}</div></div>
              <div className="rounded-2xl bg-white/10 p-3"><div className="text-white/70 text-xs mb-1">Transfer</div><div className="text-white font-mono font-semibold text-sm">{rupiah(mineTransfer)}</div></div>
              <div className="rounded-2xl bg-white/10 p-3"><div className="text-white/70 text-xs mb-1">Kurang</div><div className="text-white font-mono font-semibold text-sm">{rupiah(mineKurang)}</div></div>
              <div className="rounded-2xl bg-white/10 p-3"><div className="text-white/70 text-xs mb-1">Bayar Dobel</div><div className="text-white font-mono font-semibold text-sm">{rupiah(mineDobel)}</div></div>
            </div>
          </div>
        )}
      </div>
      <div className="p-5 relative z-10">
        {!isCurrentMonth && (
          <div className="rounded-2xl p-3 mb-3" style={{ background: "#EAF0F6" }}>
            <p className="text-xs" style={{ color: NAVY }}>Anda sedang mencatat pembayaran untuk <b>{monthLabel(entryMonth)}</b> — bukan bulan berjalan. Cocok untuk mencatat pelanggan yang baru bayar sekarang meski tagihan bulan itu sudah lewat.</p>
          </div>
        )}
        {belumTanpaKet.length > 0 && (
          <div className="rounded-2xl bg-white border border-gray-100 p-4 mb-3">
            <div className="font-semibold text-sm mb-1" style={{ color: AMBER }}>Belum bayar & belum ada keterangan ({belumTanpaKet.length})</div>
            <p className="text-xs text-gray-400">Isi status/keterangan untuk pelanggan ini di daftar bawah.</p>
          </div>
        )}
        <div className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 mb-3">
          <Search size={15} color="#9CA3AF" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari nama / daerah" className="flex-1 py-2.5 text-sm outline-none" />
        </div>
        <div className="flex gap-2 mb-3 overflow-x-auto">
          {[
            ["semua", `Semua (${mine.length})`, NAVY],
            ["sudah", `Sudah Membayar (${sudahBayarCount})`, TEAL],
            ["belum", `Belum Membayar (${mine.length - sudahBayarCount})`, AMBER],
            ["dobel", `Minta Dobel Bln Depan (${mintaDobelCount})`, "#B0362A"],
            ["dobel_lunas", `Sudah Bayar Dobel (${bayarDobelCount})`, "#7C2D12"],
          ].map(([k, label, color]) => (
            <button key={k} onClick={() => setBayarFilter(k)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border"
              style={bayarFilter === k ? { background: color, color: "white", borderColor: color } : { borderColor: "#E5E7EB", color: "#6B7280" }}>{label}</button>
          ))}
        </div>
        {daerahList.length > 1 && (
          <div className="flex gap-2 mb-3 overflow-x-auto">
            <button onClick={() => setDaerahFilter("semua")} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border"
              style={daerahFilter === "semua" ? { background: NAVY, color: "white", borderColor: NAVY } : { borderColor: "#E5E7EB", color: "#6B7280" }}>Semua daerah</button>
            {daerahList.map((d) => (
              <button key={d} onClick={() => setDaerahFilter(d)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border"
                style={daerahFilter === d ? { background: NAVY, color: "white", borderColor: NAVY } : { borderColor: "#E5E7EB", color: "#6B7280" }}>{d}</button>
            ))}
          </div>
        )}
        <div className="space-y-2">
          {filtered.map((c) => <PayRow key={c.id} customer={c} existing={paidMap.get(c.id)} onSave={save} month={entryMonth} />)}
          {mine.length === 0 && <p className="text-xs text-gray-400 text-center py-10">Belum ada pelanggan yang ditugaskan ke Anda.</p>}
          {mine.length > 0 && filtered.length === 0 && <p className="text-xs text-gray-400 text-center py-10">Tidak ada pelanggan ditemukan.</p>}
        </div>
      </div>
    </div>
  );
}


export default function App() {
  const { user, profile, error } = useAuthProfile();
  const { customers, ready } = useCustomers();
  const penagihList = usePenagihList();

  if (user === undefined || (user && !profile && !error)) {
    return <div className="min-h-screen flex items-center justify-center" style={{ background: CREAM }}><Loader2 className="animate-spin" color={NAVY} size={28} /></div>;
  }
  if (!user) return <LoginScreen error={null} />;
  if (error) return <LoginScreen error={error} />;
  if (!ready) return <div className="min-h-screen flex items-center justify-center" style={{ background: CREAM }}><Loader2 className="animate-spin" color={NAVY} size={28} /></div>;

  return (
    <div style={{ fontFamily: "'Inter', sans-serif" }}>
      {profile.role === "admin" && <AdminView profile={profile} customers={customers} penagihList={penagihList} onLogout={() => signOut(auth)} />}
      {profile.role === "penagih" && <PenagihView profile={profile} uid={user.uid} customers={customers} onLogout={() => signOut(auth)} />}
    </div>
  );
}
