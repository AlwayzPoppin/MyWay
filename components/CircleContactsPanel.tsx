import React, { useEffect, useRef, useState } from 'react';
import { Phone, MessageSquare, Copy, X } from 'lucide-react';
import { FamilyMember } from '../types';
import { FamilyCircle } from '../services/authService';
import { ContactAction, CircleContacts, loadCircleContacts, saveContactPreferences, openNativeContact } from '../services/nativeContactService';

interface Props {
    members: FamilyMember[];
    currentUserId: string;
    userCircles: FamilyCircle[];
    initialRecipientId?: string | null;
    initialAction?: ContactAction;
    onClose: () => void;
    theme: 'light' | 'dark';
}

export default function CircleContactsPanel({ members, currentUserId, userCircles, initialRecipientId, initialAction = 'text', onClose, theme }: Props) {
    const [data, setData] = useState<CircleContacts | null>(null);
    const [phone, setPhone] = useState('');
    const [sharedWith, setSharedWith] = useState<string[]>([]);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [retry, setRetry] = useState(0);
    const launched = useRef(false);
    const circleKey = userCircles.map(circle => circle.id).sort().join('|');
    useEffect(() => {
        let active = true;
        setLoading(true);
        setData(null);
        setError('');
        void loadCircleContacts(circleKey ? circleKey.split('|') : []).then(async result => {
            if (!active) return;
            setData(result);
            setPhone(result.preferences.phone);
            setSharedWith(result.preferences.circleIds.filter(id => userCircles.some(circle => circle.id === id)));
            if (initialRecipientId && !launched.current) {
                launched.current = true;
                const number = result.contacts[initialRecipientId];
                if (number) {
                    try { await openNativeContact(number, initialAction); }
                    catch { if (active) setError('Could not open the phone app. Use Copy number instead.'); }
                } else setNotice('This member has not shared a contact number with your circle.');
            }
        }).catch(() => { if (active) setError('Could not load contact sharing. Check your connection and retry.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [circleKey, currentUserId, retry, initialRecipientId, initialAction]);

    const contact = async (memberId: string, action: ContactAction | 'copy') => {
        setBusy(true); setError(''); setNotice('');
        try {
            // Revalidate sharing and membership before every handoff/copy.
            const fresh = await loadCircleContacts(circleKey ? circleKey.split('|') : []);
            setData(fresh);
            const number = fresh.contacts[memberId];
            if (!number) { setNotice('Contact number not shared.'); return; }
            if (action === 'copy') { await navigator.clipboard.writeText(number); setNotice('Number copied.'); }
            else await openNativeContact(number, action);
        } catch { setError('Could not complete that action. Check your connection or try copying the number.'); }
        finally { setBusy(false); }
    };

    const save = async () => {
        setBusy(true); setError(''); setNotice('');
        try {
            await saveContactPreferences({ phone, circleIds: sharedWith });
            setNotice('Contact sharing saved.');
        } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save. Please retry.'); }
        finally { setBusy(false); }
    };
    return <section role="dialog" aria-modal="true" aria-label="Circle contacts" className={`h-full flex flex-col rounded-2xl border shadow-xl overflow-hidden ${theme === 'dark' ? 'bg-slate-900 text-white border-slate-700' : 'bg-white text-slate-900 border-slate-200'}`}>
        <header className="flex items-center justify-between p-4 border-b border-slate-200/30"><h2 className="font-bold">Circle contacts</h2><button type="button" onClick={onClose} aria-label="Close contacts" className="p-2"><X size={20} /></button></header>
        <div className="p-4 overflow-y-auto space-y-4">
            <p className="text-sm">Text and Call open your phone’s apps. You choose when to send or call.</p>
            {loading && <p role="status">Loading contacts…</p>}
            {error && <div role="alert" className="text-sm text-red-500">{error}{!data && <button type="button" className="ml-2 underline" onClick={() => setRetry(value => value + 1)}>Retry</button>}</div>}
            {notice && <p role="status" className="text-sm">{notice}</p>}
            {data && <>
                {members.filter(member => member.id !== currentUserId).map(member => <div key={member.id} className="rounded-xl border border-slate-300/30 p-3 space-y-2">
                    <p className="font-bold">{member.name}</p>
                    <p className="text-xs">{data.contacts[member.id] ? 'Contact number shared' : 'Contact number not shared'}</p>
                    <div className="flex flex-wrap gap-2">{(['text', 'call', 'copy'] as const).map(action => <button key={action} type="button" disabled={busy || !data.contacts[member.id]} onClick={() => void contact(member.id, action)} className="min-h-11 px-3 rounded-lg bg-violet-600 text-white disabled:opacity-40 flex items-center gap-2 text-sm" aria-label={`${action === 'copy' ? 'Copy number for' : action} ${member.name}`}>
                        {action === 'text' ? <MessageSquare size={16} /> : action === 'call' ? <Phone size={16} /> : <Copy size={16} />}{action === 'text' ? 'Text' : action === 'call' ? 'Call' : 'Copy number'}
                    </button>)}</div>
                </div>)}
                {members.every(member => member.id === currentUserId) && <p className="text-sm">No other circle members to contact yet.</p>}
                <form onSubmit={event => { event.preventDefault(); void save(); }} className="border-t border-slate-300/30 pt-4 space-y-3">
                    <h3 className="font-bold">Your contact number</h3>
                    <label className="block text-sm">Include country code<input type="tel" autoComplete="tel" value={phone} disabled={busy} onChange={event => setPhone(event.target.value)} placeholder="+1 910 555 0123" className="mt-1 w-full rounded-lg border border-slate-300 p-3 bg-transparent" /></label>
                    <p className="text-xs">Share only with circles you select. Numbers already copied by someone cannot be recalled. This number is self-reported, not verified.</p>
                    {userCircles.map(circle => <label key={circle.id} className="flex items-center gap-3 min-h-11 text-sm"><input type="checkbox" checked={sharedWith.includes(circle.id)} disabled={busy} onChange={event => setSharedWith(previous => event.target.checked ? [...previous, circle.id] : previous.filter(id => id !== circle.id))} />{circle.name}</label>)}
                    {!userCircles.length && <p className="text-sm">Join a circle to enable contact sharing.</p>}
                    <button type="submit" disabled={busy || loading} className="min-h-11 px-4 rounded-xl bg-violet-600 text-white disabled:opacity-40">{busy ? 'Please wait…' : 'Save contact sharing'}</button>
                </form>
            </>}
        </div>
    </section>;
}
