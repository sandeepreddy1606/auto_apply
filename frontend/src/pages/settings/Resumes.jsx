import { useEffect, useRef, useState } from 'react'
import { api } from '../../api'
import { useToast } from '../../Toast'
import PageHeader from '../../components/PageHeader'
import { DocIcon } from '../../components/Icons'

function ResumeRow({ r, onChanged }) {
  const [name, setName] = useState(r.name)
  const [keywords, setKeywords] = useState(r.keywords || '')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const dirty = name !== r.name || keywords !== (r.keywords || '')

  const save = async () => {
    setBusy(true)
    try {
      await api.updateResume(r.id, { name, keywords })
      toast('Saved.', 'success')
      onChanged()
    } catch (e) { toast(e.message, 'error') } finally { setBusy(false) }
  }
  const makeDefault = async () => {
    try { await api.updateResume(r.id, { is_default: true }); onChanged() }
    catch (e) { toast(e.message, 'error') }
  }
  const remove = async () => {
    if (!window.confirm(`Delete "${r.name}"?`)) return
    try { await api.deleteResume(r.id); onChanged() }
    catch (e) { toast(e.message, 'error') }
  }
  const download = () => api.downloadResume(r.id, r.original).catch((e) => toast(e.message, 'error'))

  return (
    <div className={`resume-row ${r.is_default ? 'is-default' : ''}`}>
      <div className="resume-main">
        <div className="grid-2">
          <label className="field">
            <span className="lbl">Label</span>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="lbl">Use for roles (keywords, comma separated)</span>
            <input value={keywords} placeholder="e.g. frontend, react, node"
              onChange={(e) => setKeywords(e.target.value)} />
          </label>
        </div>
        <div className="resume-meta">
          {r.original} · {r.size_kb} KB
          {r.is_default && <span className="badge applied" style={{ marginLeft: 8 }}>default</span>}
        </div>
      </div>
      <div className="resume-actions">
        {dirty && <button className="btn sm primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>}
        {!r.is_default && <button className="btn sm" onClick={makeDefault}>Make default</button>}
        <button className="btn sm" onClick={download}>Download</button>
        <button className="btn sm danger" onClick={remove}>Delete</button>
      </div>
    </div>
  )
}

export default function ResumesPage() {
  const [resumes, setResumes] = useState(null)
  const [name, setName] = useState('')
  const [keywords, setKeywords] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef(null)
  const toast = useToast()

  const load = () => api.listResumes().then((d) => setResumes(d.resumes || [])).catch((e) => toast(e.message, 'error'))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const upload = async () => {
    const file = fileRef.current?.files?.[0]
    if (!file) { toast('Choose a file to upload.', 'error'); return }
    setUploading(true)
    try {
      await api.uploadResume(file, name, keywords)
      setName(''); setKeywords('')
      if (fileRef.current) fileRef.current.value = ''
      toast('Resume uploaded.', 'success')
      load()
    } catch (e) { toast(e.message, 'error') } finally { setUploading(false) }
  }

  const hasDefault = (resumes || []).some((r) => r.is_default)

  return (
    <>
      <PageHeader title="Resumes" sub="Attached to email applications by role" backTo="/settings" />

      <div className="settings-stack">
        <div className="card">
          <h3><DocIcon style={{ width: 18, height: 18 }} /> Add a resume</h3>
          <p className="muted" style={{ marginBottom: 14, fontSize: 13 }}>
            Upload one or more resumes and tag each with the roles it fits. When you apply by email,
            the resume whose keywords match the job’s role is attached automatically — and if no role
            matches, your <strong>default</strong> resume is used. PDF/DOC/DOCX, up to 10&nbsp;MB.
          </p>
          <div className="grid-2">
            <label className="field">
              <span className="lbl">File</span>
              <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.rtf,.odt,.txt" />
            </label>
            <label className="field">
              <span className="lbl">Label (optional)</span>
              <input value={name} placeholder="e.g. Frontend resume" onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          <label className="field" style={{ marginTop: 12 }}>
            <span className="lbl">Use for roles (keywords, comma separated — leave blank for default only)</span>
            <input value={keywords} placeholder="e.g. frontend, react, javascript" onChange={(e) => setKeywords(e.target.value)} />
          </label>
          <div className="row-actions">
            <button className="btn primary" disabled={uploading} onClick={upload}>
              {uploading ? 'Uploading…' : 'Upload resume'}
            </button>
          </div>
        </div>

        <div className="card">
          <h3><DocIcon style={{ width: 18, height: 18 }} /> Your resumes</h3>
          {resumes === null && <p className="muted">Loading…</p>}
          {resumes?.length === 0 && (
            <p className="muted" style={{ fontSize: 13 }}>
              No resumes yet. Upload one above — the first becomes your default automatically.
            </p>
          )}
          {resumes?.length > 0 && !hasDefault && (
            <p className="warn-text" style={{ marginBottom: 10 }}>
              No default set — pick one so there’s always a resume to attach when no role matches.
            </p>
          )}
          {resumes?.length > 0 && (
            <div className="resume-list">
              {resumes.map((r) => <ResumeRow key={r.id} r={r} onChanged={load} />)}
            </div>
          )}
        </div>

        <p className="muted" style={{ fontSize: 12.5 }}>
          Note: this attaches files to <strong>email</strong> applications. Google Forms that ask for a
          resume link use the <em>Resume link</em> field in your Profile.
        </p>
      </div>
    </>
  )
}
