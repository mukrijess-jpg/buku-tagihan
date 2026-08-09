import { useState, useEffect, useMemo } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { getFirestore, collection, doc, getDoc, setDoc, addDoc, updateDoc, onSnapshot, query, where, writeBatch } from "firebase/firestore";
import { firebaseConfig } from "./firebaseConfig";
import { Search, Plus, X, Users, Wallet, Ban, LogOut, Loader2, Lock, Mail, Pencil, History, ShieldCheck, Upload } from "lucide-react";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const NAVY = "#16324F";
const TEAL = "#2A9D8F";
const AMBER = "#E76F51";
const CREAM = "#F6F7F5";
const INK = "#1A1D23";
const KOMISI_PER_PELANGGAN = 4000;

const monthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key) => {
  const [y, m] = key.split("-");
  const names = ["Januari","Februari","Maret","April","Mei","Juni","Juli","Agustus","September","Oktober","November","Desember"];
  return `${names[parseInt(m, 10) - 1]} ${y}`;
};
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

const STATUS_LABEL = {
  cash: { label: "Lunas · Cash", color: TEAL, bg: "#E6F4F1" },
  transfer: { label: "Lunas · Transfer", color: NAVY, bg: "#EAF0F6" },
  belum: { label: "Belum Bayar", color: AMBER, bg: "#FBEAE6" },
  belum_dobel: { label: "Belum Bayar (Dobel Bln Depan)", color: "#B0362A", bg: "#FBEAE6" },
};

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

async function savePaymentRecord({ month, customer, status, keterangan, jumlah, penagihUid }) {
  const payId = `${month}_${customer.id}`;
  await setDoc(doc(db, "payments", payId), {
    month, customerId: customer.id, status, keterangan: keterangan || "",
    jumlah: jumlah || 0, penagihId: penagihUid, tanggal: new Date().toISOString(),
  });
  // Efek "dobel bulan depan"
  if (status === "belum_dobel") {
    await updateDoc(doc(db, "customers", customer.id), { dendaBulanDepan: true });
  } else if (status === "cash" || status === "transfer") {
    await updateDoc(doc(db, "customers", customer.id), { dendaBulanDepan: false });
  }
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
function effectiveTagihan(c) { return c.dendaBulanDepan ? c.harga * 2 : c.harga; }

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
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center" style={{ background: NAVY }}>
            <ShieldCheck color="white" size={26} />
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
function CustomerForm({ onSave, onCancel, penagihList, initial }) {
  const [form, setForm] = useState(initial || { nama: "", daerah: "", harga: "", status: "aktif", penagihId: penagihList[0]?.uid || "" });
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
          <div><label className="text-xs text-gray-500">Harga per bulan (Rp)</label>
            <input type="number" value={form.harga} onChange={(e) => setForm({ ...form, harga: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 outline-none focus:border-gray-400" /></div>
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
        </div>
        <button onClick={() => onSave({ ...form, harga: Number(form.harga) || 0 })} disabled={!form.nama || !form.daerah}
          className="w-full mt-5 py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-40" style={{ background: TEAL }}>
          Simpan
        </button>
      </div>
    </div>
  );
}

// ---------- Import massal pelanggan (khusus Admin) ----------
function parseBulkRows(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      // Terima paste dari Excel/Spreadsheet (pemisah TAB) atau ketik manual (pemisah koma/titik koma)
      const cols = line.includes("\t") ? line.split("\t") : line.split(/[,;]/);
      const [nama, daerah, harga, penagihNama] = cols.map((c) => (c || "").trim());
      return { nama, daerah, harga, penagihNama };
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
      for (const chunk of chunks) {
        const batch = writeBatch(db);
        chunk.forEach((r) => {
          const uid = findPenagihUid(r.penagihNama);
          if (r.penagihNama && !uid) notFoundPenagih.add(r.penagihNama);
          const ref = doc(collection(db, "customers"));
          batch.set(ref, {
            nama: r.nama,
            daerah: r.daerah,
            harga: Number(String(r.harga).replace(/\D/g, "")) || 0,
            status: "aktif",
            penagihId: uid || "",
            dendaBulanDepan: false,
          });
          count++;
        });
        await batch.commit();
      }
      setResult({ count, notFoundPenagih: [...notFoundPenagih] });
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
              Tempel data dari Excel/Spreadsheet (kolom: <b>Nama, Daerah, Harga per bulan, Nama Penagih</b>).
              Bisa langsung select & copy beberapa baris dari Excel lalu paste di sini. Nama penagih harus sama
              persis dengan nama di daftar penagih (boleh dikosongkan kalau belum mau ditugaskan).
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"Contoh (1 pelanggan per baris):\nAgung, PADI, 110000, bekjah\nPGD Wawan, PGD-BOKOR, 150000, mbak nurul"}
              rows={8}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 outline-none resize-none font-mono"
            />
            <p className="text-xs text-gray-400 mb-3">{rows.length} baris terbaca sebagai pelanggan valid.</p>
            <button onClick={doImport} disabled={saving || rows.length === 0}
              className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-40" style={{ background: TEAL }}>
              {saving ? "Mengimpor..." : `Import ${rows.length} Pelanggan`}
            </button>
          </>
        )}

        {result && !result.error && (
          <div className="text-sm">
            <p className="mb-2" style={{ color: TEAL }}>✔ Berhasil mengimpor {result.count} pelanggan.</p>
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
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [viewMonth, setViewMonth] = useState(monthKey());
  const payments = usePayments(viewMonth);

  const daerahList = useMemo(() => [...new Set(customers.map((c) => c.daerah).filter(Boolean))].sort(), [customers]);
  const paidMap = new Map(payments.map((p) => [p.customerId, p]));
  const lunas = payments.filter((p) => p.status === "cash" || p.status === "transfer");
  const totalCash = payments.filter((p) => p.status === "cash").reduce((s, p) => s + p.jumlah, 0);
  const totalTransfer = payments.filter((p) => p.status === "transfer").reduce((s, p) => s + p.jumlah, 0);
  const isolirCount = customers.filter((c) => c.status === "isolir" || c.status === "off").length;
  const belumBayar = customers.filter((c) => c.status === "aktif" && !paidMap.has(c.id));
  const belumBayarTanpaKet = customers.filter((c) => {
    if (c.status !== "aktif") return false;
    const pay = paidMap.get(c.id);
    if (!pay) return true; // belum ada catatan sama sekali
    const isBelum = pay.status === "belum" || pay.status === "belum_dobel";
    return isBelum && !(pay.keterangan && pay.keterangan.trim());
  });

  const perDaerah = useMemo(() => daerahList.map((d) => {
    const cs = customers.filter((c) => c.daerah === d);
    const paidCs = cs.filter((c) => lunas.some((p) => p.customerId === c.id));
    const uang = lunas.filter((p) => cs.some((c) => c.id === p.customerId)).reduce((s, p) => s + p.jumlah, 0);
    return { daerah: d, total: cs.length, sudahBayar: paidCs.length, uang };
  }), [daerahList, customers, lunas]);

  const perPenagih = useMemo(() => penagihList.map((p) => {
    const cs = customers.filter((c) => c.penagihId === p.uid);
    const berhasil = lunas.filter((pay) => pay.penagihId === p.uid).length;
    const uang = lunas.filter((pay) => pay.penagihId === p.uid).reduce((s, pay) => s + pay.jumlah, 0);
    const uangCash = payments.filter((pay) => pay.penagihId === p.uid && pay.status === "cash").reduce((s, pay) => s + pay.jumlah, 0);
    const uangTransfer = payments.filter((pay) => pay.penagihId === p.uid && pay.status === "transfer").reduce((s, pay) => s + pay.jumlah, 0);
    return { ...p, ditugaskan: cs.length, berhasil, uang, uangCash, uangTransfer, komisi: berhasil * KOMISI_PER_PELANGGAN };
  }), [penagihList, customers, lunas, payments]);

  const filtered = customers
    .filter((c) => (c.nama + c.daerah).toLowerCase().includes(query.toLowerCase()))
    .filter((c) => daerahFilter === "semua" || c.daerah === daerahFilter);

  const saveCustomer = async (c) => {
    if (editing) await updateDoc(doc(db, "customers", editing.id), c);
    else await addDoc(collection(db, "customers"), { ...c, dendaBulanDepan: false });
    setShowForm(false); setEditing(null);
  };

  return (
    <div className="min-h-screen pb-6" style={{ background: CREAM }}>
      <div className="px-5 pt-5 pb-4 sticky top-0 z-10" style={{ background: NAVY }}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-white/60 text-xs">Panel Admin · {profile.nama}</div>
            <div className="text-white font-bold text-lg" style={{ fontFamily: "'Sora', sans-serif" }}>Buku Tagihan</div>
          </div>
          <button onClick={onLogout} className="text-white/70"><LogOut size={18} /></button>
        </div>
        <div className="flex gap-2 mt-4 overflow-x-auto">
          {[["ringkasan","Ringkasan"],["pelanggan","Pelanggan"],["penagih","Kinerja & Komisi"],["riwayat","Riwayat Bulan"]].map(([k,label]) => (
            <button key={k} onClick={() => setTab(k)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap"
              style={tab === k ? { background: "white", color: NAVY } : { background: "rgba(255,255,255,0.12)", color: "white" }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="p-5">
        {tab === "ringkasan" && (
          <>
            <div className="flex gap-3 flex-wrap mb-3">
              <StatCard icon={Users} label="Total Pelanggan" value={customers.length} />
              <StatCard icon={Wallet} label={`Pendapatan ${monthLabel(viewMonth)}`} value={rupiah(totalCash + totalTransfer)} accent={TEAL} sub={`${lunas.length} pelanggan lunas`} />
              <StatCard icon={Ban} label="Isolir / Off" value={isolirCount} accent={AMBER} />
            </div>
            <div className="flex gap-3 flex-wrap mb-3">
              <StatCard icon={Wallet} label="Total Cash" value={rupiah(totalCash)} accent={TEAL} sub={`${payments.filter((p) => p.status === "cash").length} pelanggan`} />
              <StatCard icon={Wallet} label="Total Transfer" value={rupiah(totalTransfer)} accent={NAVY} sub={`${payments.filter((p) => p.status === "transfer").length} pelanggan`} />
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
                  <div><div className="text-sm font-medium" style={{ color: INK }}>{c.nama}</div><div className="text-xs text-gray-400">{c.daerah}</div></div>
                  <div className="text-xs font-mono" style={{ color: AMBER }}>{rupiah(effectiveTagihan(c))}</div>
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
                    <div><div className="text-sm font-medium" style={{ color: INK }}>{c.nama}</div><div className="text-xs text-gray-400">{c.daerah} · Penagih: {p?.nama || "-"}</div></div>
                    <div className="text-xs font-mono" style={{ color: AMBER }}>{rupiah(effectiveTagihan(c))}</div>
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
            </div>
            <div className="flex gap-2 mb-3 overflow-x-auto">
              <button onClick={() => setDaerahFilter("semua")} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border"
                style={daerahFilter === "semua" ? { background: NAVY, color: "white", borderColor: NAVY } : { borderColor: "#E5E7EB", color: "#6B7280" }}>Semua daerah</button>
              {daerahList.map((d) => (
                <button key={d} onClick={() => setDaerahFilter(d)} className="px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border"
                  style={daerahFilter === d ? { background: NAVY, color: "white", borderColor: NAVY } : { borderColor: "#E5E7EB", color: "#6B7280" }}>{d}</button>
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
                        <div className="text-sm font-medium flex items-center gap-1" style={{ color: INK }}>{c.nama} <Pencil size={11} color="#C4C9D2" /></div>
                        <div className="text-xs text-gray-400">{c.daerah} · {rupiah(effectiveTagihan(c))}/bln{c.dendaBulanDepan && <span style={{ color: AMBER }}> (denda aktif)</span>}</div>
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
                <div className="flex items-center justify-between text-xs pt-2 mt-2 border-t border-gray-50">
                  <span className="font-medium" style={{ color: INK }}>Komisi (Rp{KOMISI_PER_PELANGGAN.toLocaleString("id-ID")}/pelanggan)</span>
                  <span className="font-mono font-bold" style={{ color: AMBER }}>{rupiah(p.komisi)}</span>
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
              <StatCard icon={Wallet} label={`Pendapatan ${monthLabel(viewMonth)}`} value={rupiah(totalCash + totalTransfer)} accent={TEAL} />
              <StatCard icon={Users} label="Lunas" value={`${lunas.length}/${customers.length}`} />
            </div>
            <div className="flex gap-3 flex-wrap mb-3">
              <StatCard icon={Wallet} label="Total Cash" value={rupiah(totalCash)} accent={TEAL} />
              <StatCard icon={Wallet} label="Total Transfer" value={rupiah(totalTransfer)} accent={NAVY} />
            </div>
            <div className="rounded-2xl bg-white border border-gray-100 p-4">
              <div className="font-semibold text-sm mb-3" style={{ color: NAVY }}>Rincian per Daerah — {monthLabel(viewMonth)}</div>
              {perDaerah.map((d) => (
                <div key={d.daerah} className="flex items-center justify-between text-sm py-1.5 border-b border-gray-50 last:border-0">
                  <span style={{ color: INK }}>{d.daerah}</span>
                  <span className="text-xs text-gray-400">{d.sudahBayar}/{d.total} bayar</span>
                  <span className="font-mono text-xs font-semibold" style={{ color: TEAL }}>{rupiah(d.uang)}</span>
                </div>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-3">Data bulan-bulan sebelumnya tersimpan permanen dan tidak pernah terhapus — setiap bulan baru otomatis mulai kosong tanpa menghapus riwayat.</p>
          </>
        )}
      </div>

      {showForm && <CustomerForm initial={editing} penagihList={penagihList} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={saveCustomer} />}
      {showBulkImport && (
        <BulkImportForm
          penagihList={penagihList}
          onCancel={() => setShowBulkImport(false)}
          onImported={() => setShowBulkImport(false)}
        />
      )}
    </div>
  );
}

// ---------- Panel Penagih ----------
function PayRow({ customer, existing, onSave }) {
  const [editingRow, setEditingRow] = useState(!existing);
  const [status, setStatus] = useState(existing?.status || "");
  const [keterangan, setKeterangan] = useState(existing?.keterangan || "");
  const [jumlahInput, setJumlahInput] = useState(existing?.jumlah ? String(existing.jumlah) : "");
  const tagihan = effectiveTagihan(customer);
  const isLunas = status === "cash" || status === "transfer";

  const submit = () => {
    if (!status) return;
    if (isLunas && !jumlahInput) return;
    const jumlah = isLunas ? Number(jumlahInput) || 0 : 0;
    onSave(customer, status, keterangan, jumlah);
    setEditingRow(false);
  };

  if (!editingRow && existing) {
    const st = STATUS_LABEL[existing.status];
    const isPaidExisting = existing.status === "cash" || existing.status === "transfer";
    return (
      <div className="rounded-xl bg-white border border-gray-100 p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium" style={{ color: INK }}>{customer.nama}</div>
            <div className="text-xs text-gray-400">{customer.daerah} · {isPaidExisting ? rupiah(existing.jumlah) : rupiah(tagihan) + "/bln"}</div>
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
    <div className="rounded-xl bg-white border border-gray-100 p-3">
      <div className="text-sm font-medium" style={{ color: INK }}>{customer.nama} {customer.status !== "aktif" && <Badge color={AMBER} bg="#FBEAE6">{customer.status}</Badge>}</div>
      <div className="text-xs text-gray-400 mb-2">{customer.daerah}{customer.dendaBulanDepan && <span style={{ color: AMBER }}> (denda dobel aktif)</span>}</div>
      <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 outline-none">
        <option value="">Pilih status bayar...</option>
        <option value="cash">Lunas · Cash</option>
        <option value="transfer">Lunas · Transfer</option>
        <option value="belum">Belum Bayar</option>
        <option value="belum_dobel">Belum Bayar — Dobel Bulan Depan</option>
      </select>
      {isLunas && (
        <div className="mb-2">
          <label className="text-xs text-gray-500">Jumlah diterima (Rp)</label>
          <input type="number" value={jumlahInput} onChange={(e) => setJumlahInput(e.target.value)} placeholder="Tulis jumlah yang diterima"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mt-1 outline-none focus:border-gray-400" />
        </div>
      )}
      <textarea value={keterangan} onChange={(e) => setKeterangan(e.target.value)} placeholder="Keterangan (opsional)" rows={2}
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2 outline-none resize-none" />
      <div className="flex gap-2">
        {existing && <button onClick={() => setEditingRow(false)} className="flex-1 text-xs font-medium py-2 rounded-lg border border-gray-200 text-gray-500">Batal</button>}
        <button onClick={submit} disabled={!status || (isLunas && !jumlahInput)} className="flex-1 text-xs font-semibold py-2 rounded-lg text-white disabled:opacity-40" style={{ background: TEAL }}>Simpan</button>
      </div>
    </div>
  );
}

function PenagihView({ profile, uid, customers, onLogout }) {
  const month = monthKey();
  const payments = usePayments(month);
  const [query, setQuery] = useState("");
  const [daerahFilter, setDaerahFilter] = useState("semua");
  const mine = customers.filter((c) => c.penagihId === uid);
  const daerahList = useMemo(() => [...new Set(mine.map((c) => c.daerah).filter(Boolean))].sort(), [mine]);
  const filtered = mine
    .filter((c) => (c.nama + c.daerah).toLowerCase().includes(query.toLowerCase()))
    .filter((c) => daerahFilter === "semua" || c.daerah === daerahFilter);
  const paidMap = new Map(payments.filter((p) => p.penagihId === uid).map((p) => [p.customerId, p]));
  const berhasil = mine.filter((c) => { const p = paidMap.get(c.id); return p && (p.status === "cash" || p.status === "transfer"); }).length;
  const mineCash = [...paidMap.values()].filter((p) => p.status === "cash").reduce((s, p) => s + p.jumlah, 0);
  const mineTransfer = [...paidMap.values()].filter((p) => p.status === "transfer").reduce((s, p) => s + p.jumlah, 0);
  const uang = mineCash + mineTransfer;
  const belumTanpaKet = mine.filter((c) => {
    const p = paidMap.get(c.id);
    if (!p) return true;
    const isBelum = p.status === "belum" || p.status === "belum_dobel";
    return isBelum && !(p.keterangan && p.keterangan.trim());
  });

  const save = (customer, status, keterangan, jumlah) => savePaymentRecord({ month, customer, status, keterangan, jumlah, penagihUid: uid });

  return (
    <div className="min-h-screen pb-6" style={{ background: CREAM }}>
      <div className="px-5 pt-5 pb-4 sticky top-0 z-10" style={{ background: NAVY }}>
        <div className="flex items-center justify-between">
          <div><div className="text-white/60 text-xs">{monthLabel(month)}</div><div className="text-white font-bold text-lg" style={{ fontFamily: "'Sora', sans-serif" }}>{profile.nama}</div></div>
          <button onClick={onLogout} className="text-white/70"><LogOut size={18} /></button>
        </div>
        <div className="mt-4">
          <div className="rounded-2xl bg-white/10 p-3"><div className="text-white/70 text-xs mb-1">Berhasil ditarik</div><div className="text-white font-mono font-semibold">{berhasil}/{mine.length}</div></div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="rounded-2xl bg-white/10 p-3"><div className="text-white/70 text-xs mb-1">Cash</div><div className="text-white font-mono font-semibold">{rupiah(mineCash)}</div></div>
          <div className="rounded-2xl bg-white/10 p-3"><div className="text-white/70 text-xs mb-1">Transfer</div><div className="text-white font-mono font-semibold">{rupiah(mineTransfer)}</div></div>
        </div>
      </div>
      <div className="p-5">
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
          {filtered.map((c) => <PayRow key={c.id} customer={c} existing={paidMap.get(c.id)} onSave={save} />)}
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
