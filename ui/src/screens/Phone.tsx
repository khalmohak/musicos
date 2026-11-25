import { Button, Field, Input, PasswordInput, toast } from '@glyphui/ui'
import { type FormEvent, useEffect, useState } from 'react'
import { Record, Wordmark } from '../components/Record'
import { type Source, api } from '../lib/api'

/** Opened on a phone from the QR code: typing share details on a TV remote is no fun. */
export function Phone() {
  const [sources, setSources] = useState<Source[]>([])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ name: '', server: '', share: '', path: '', username: '', password: '' })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value })

  const refresh = () => api.sources().then(setSources).catch(() => {})
  useEffect(() => {
    document.body.style.cursor = 'auto'
    document.body.style.overflow = 'auto'
    document.documentElement.style.fontSize = '16px'
    refresh()
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.addShare(form)
      toast.success('Share added. The TV will start scanning it.')
      setForm({ name: '', server: '', share: '', path: '', username: '', password: '' })
      setTimeout(refresh, 1500)
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto min-h-full max-w-md px-5 py-8">
      <div className="flex items-center gap-3">
        <Record size="2.2rem" spinning={false} />
        <Wordmark className="text-sm" />
      </div>
      <h1 className="mt-8 text-2xl font-semibold">Add a network share</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        A Windows/Samba share or NAS folder with your music. It is mounted read-only.
      </p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field label="Name" description="Shown on the TV, e.g. Homelab">
          <Input value={form.name} onChange={set('name')} placeholder="Homelab" />
        </Field>
        <Field label="Server" required description="Hostname or IP address">
          <Input value={form.server} onChange={set('server')} placeholder="192.168.1.109" required inputMode="url" />
        </Field>
        <Field label="Share" required>
          <Input value={form.share} onChange={set('share')} placeholder="8TB" required />
        </Field>
        <Field label="Folder inside the share" description="Optional">
          <Input value={form.path} onChange={set('path')} placeholder="media/music/library" />
        </Field>
        <Field label="Username" description="Leave empty for guest access">
          <Input value={form.username} onChange={set('username')} autoComplete="username" />
        </Field>
        <Field label="Password">
          <PasswordInput value={form.password} onChange={set('password')} autoComplete="current-password" />
        </Field>
        <Button type="submit" disabled={busy || !form.server || !form.share}>
          {busy ? 'Adding…' : 'Add share'}
        </Button>
      </form>

      {sources.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-medium text-muted-foreground">Connected sources</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {sources.map((s) => (
              <li key={s.id} className="flex items-center justify-between rounded-lg bg-surface px-4 py-3 text-sm">
                <span>
                  {s.name} <span className="text-muted-foreground">· {s.kind}</span>
                </span>
                {s.kind === 'network' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => api.removeSource(s.id.replace(/^net-/, '')).then(() => setTimeout(refresh, 800))}
                  >
                    Remove
                  </Button>
                ) : (
                  <span className={s.mounted ? 'text-success-text' : 'text-muted-foreground'}>
                    {s.mounted ? 'Connected' : 'Waiting'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
