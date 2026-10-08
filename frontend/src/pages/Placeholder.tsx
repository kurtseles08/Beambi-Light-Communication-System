export default function Placeholder({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-slate-400">{note}</p>
      <div className="mt-6 rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-500">
        wala pa ngang data nganii
      </div>
    </div>
  )
}