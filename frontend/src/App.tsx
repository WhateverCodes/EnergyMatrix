import { useEffect, useState } from 'react'

export default function App() {
  const [status, setStatus] = useState('checking')
  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((d) => setStatus(d.status))
      .catch(() => setStatus('backend unreachable'))
  }, [])
  return <main className="p-6 font-mono">GridTwin backend: {status}</main>
}
