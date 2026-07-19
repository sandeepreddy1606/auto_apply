import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useToast } from '../Toast'

// Title -> profile-key rules (mirrors backend/app/gform.py FIELD_RULES). A null
// key means "recognised but don't fill" (e.g. "company name" must not map to your name).
const RULES = [
  ['first\\s*name', 'first_name'],
  ['last\\s*name|surname', 'last_name'],
  ['(company|college|institute|university|father|mother|referr?er).{0,12}name', null],
  ['full\\s*name|candidate\\s*name|your\\s*name|^name\\b|\\bname\\s*[:?]?$', 'full_name'],
  ['e-?mail|mail\\s*id', 'email'],
  ['phone|mobile|contact\\s*(no|num)|whats\\s*app', 'phone'],
  ['resume|\\bcv\\b|curriculum', 'resume_url'],
  ['linked\\s*in', 'linkedin'],
  ['git\\s*hub', 'github'],
  ['portfolio|personal\\s*website', 'portfolio'],
  ['notice\\s*period|how\\s*soon.*join|joining', 'notice_period'],
  ['(total|overall|relevant|years?\\s*of)\\s*.*experience|experience|\\byoe\\b|\\bexp\\b', 'experience_years'],
  ['current\\s*(ctc|salary|compensation|package)', 'current_ctc'],
  ['expected\\s*(ctc|salary|compensation|package)|salary\\s*expectation', 'expected_ctc'],
  ['\\bctc\\b|salary|compensation|package|stipend', 'expected_ctc'],
  ['current\\s*(company|organi[sz]ation|employer)|company|organi[sz]ation|employer', 'current_company'],
  ['designation|current\\s*(role|position)|job\\s*title', 'current_role'],
  ['preferred\\s*location', 'preferred_location'],
  ['location|city|based\\s*(in|out)', 'current_location'],
  ['relocat', 'willing_to_relocate'],
  ['gender|\\bsex\\b', 'gender'],
  ['college|university|institute|school', 'college'],
  ['degree|qualification|education', 'degree'],
  ['graduat|passing\\s*year|pass\\s*out|batch|year\\s*of\\s*(pass|complet)', 'graduation_year'],
  ['skill|tech\\s*stack|technolog', 'skills'],
  ['date\\s*of\\s*birth|\\bdob\\b', 'date_of_birth'],
  ['why|cover\\s*letter|about\\s*(yourself|you)|tell\\s*us|describe|motivation|anything\\s*else', 'cover_note'],
]

// The in-page filler. P (profile) + R (rules) are injected; everything else runs
// on the Google Form page in the user's signed-in browser.
function buildBookmarklet(profile) {
  const P = JSON.stringify(profile)
  const R = JSON.stringify(RULES)
  const code = `javascript:(function(){try{
var P=${P},R=${R};
function pv(k){if(k==='first_name'){return (P.full_name||'').trim().split(/\\s+/)[0]||'';}if(k==='last_name'){var a=(P.full_name||'').trim().split(/\\s+/);return a.length>1?a[a.length-1]:'';}return P[k]||'';}
function mt(t){t=(t||'').toLowerCase();for(var i=0;i<R.length;i++){try{if(new RegExp(R[i][0]).test(t))return R[i][1];}catch(e){}}return null;}
function sv(el,v){try{var p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var s=Object.getOwnPropertyDescriptor(p,'value').set;s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}catch(e){}}
function cm(els,v){v=(v||'').trim().toLowerCase();if(!v)return false;var a=[].slice.call(els),i,l;for(i=0;i<a.length;i++){l=((a[i].getAttribute('aria-label')||a[i].innerText||'')).trim().toLowerCase();if(l===v){a[i].click();return true;}}for(i=0;i<a.length;i++){l=((a[i].getAttribute('aria-label')||a[i].innerText||'')).trim().toLowerCase();if(l&&(l.indexOf(v)>=0||v.indexOf(l)>=0)){a[i].click();return true;}}return false;}
var items=document.querySelectorAll('div[role=listitem]'),f=0;
if(!items.length){alert('No Google Form questions found on THIS page.\\n\\nClick the Autofill bookmark on the Google Form tab itself — not on the Auto Apply app or the embedded preview.');return;}
items.forEach(function(it){var h=it.querySelector('div[role=heading]');if(!h)return;var k=mt(h.innerText);if(!k)return;var v=pv(k);if(!v)return;
var inp=it.querySelector('input[type=text],input[type=email],input[type=url],input[type=tel],input:not([type])');if(inp){sv(inp,v);f++;return;}
var ta=it.querySelector('textarea');if(ta){sv(ta,v);f++;return;}
var rd=it.querySelectorAll('div[role=radio]');if(rd.length){if(cm(rd,v))f++;return;}
var ck=it.querySelectorAll('div[role=checkbox]');if(ck.length){var d=false;v.split(/[,\\/;]/).forEach(function(p){if(cm(ck,p.trim()))d=true;});if(d)f++;return;}
var lb=it.querySelector('div[role=listbox]');if(lb){lb.click();setTimeout(function(){cm(document.querySelectorAll('div[role=option]'),v);},350);f++;return;}});
alert('Auto-filled '+f+' field(s) from your profile. Review, complete anything blank, then submit.');
}catch(e){alert('Auto-fill error: '+e.message);}})();`
  return code.replace(/\n/g, '')
}

export default function Bookmarklet() {
  const [profile, setProfile] = useState(null)
  const linkRef = useRef(null)
  const toast = useToast()

  useEffect(() => {
    api.getSettings().then((s) => setProfile(s.profile || {})).catch(() => setProfile({}))
  }, [])

  const code = useMemo(() => (profile ? buildBookmarklet(profile) : ''), [profile])

  // React strips javascript: hrefs, so set it on the DOM node directly.
  useEffect(() => {
    if (linkRef.current && code) linkRef.current.setAttribute('href', code)
  }, [code])

  if (!profile) return null
  const hasData = Object.values(profile).some((v) => String(v || '').trim())

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      toast('Bookmarklet copied. Create a new bookmark and paste it as the URL.', 'success')
    } catch {
      toast('Copy failed — drag the button to your bookmarks bar instead.', 'error')
    }
  }

  return (
    <div className="bookmarklet">
      <div className="bm-head">One-click autofill (works even on sign-in forms)</div>
      {!hasData && <p className="warn-text" style={{ fontSize: 12.5 }}>Fill your profile in Settings first so there’s data to autofill.</p>}
      <p className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
        Setup once: drag <a ref={linkRef} className="bm-btn" href="#" onClick={(e) => e.preventDefault()}>⚡ Autofill Form</a> to
        your browser’s bookmarks bar. <span style={{ color: 'var(--text)' }}>(Can’t see a bookmarks bar? Press Ctrl+Shift+B, or use “Copy bookmarklet” below.)</span>
      </p>
      <ol className="bm-steps">
        <li>Click <strong>“Open the form ↗”</strong> above — it opens in a new tab where you’re signed in.</li>
        <li><strong>On that form tab</strong> (not here), click your <strong>⚡ Autofill Form</strong> bookmark.</li>
        <li>It fills every field it recognises; a popup shows how many. Complete anything left blank.</li>
        <li>Submit the form. Then come back and tap <strong>Mark applied</strong>.</li>
      </ol>
      <button className="btn sm" onClick={copy}>Copy bookmarklet instead</button>
    </div>
  )
}
