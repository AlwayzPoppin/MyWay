
import React, { useState, useRef, useEffect } from 'react';
import { ChatMessage, FamilyMember, GroundingLink } from '../types';
import { askOmni } from '../services/geminiService';

interface ChatPanelProps {
  onClose: () => void;
  messages: ChatMessage[];
  onSend: (text: string, links?: GroundingLink[]) => void;
  members: FamilyMember[];
  theme: 'light' | 'dark';
}

const ChatPanel: React.FC<ChatPanelProps> = ({ onClose, messages: externalMessages, onSend, members, theme }) => {
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>(externalMessages);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [localMessages, isTyping]);

  const handleSend = async () => {
    if (!inputText.trim()) return;
    const userText = inputText;
    setInputText('');
    const userMsg: ChatMessage = { id: Date.now().toString(), senderId: 'user', text: userText, timestamp: new Date().toISOString() };
    setLocalMessages(prev => [...prev, userMsg]);
    setIsTyping(true);
    const result = await askOmni(userText, members, localMessages);
    const aiMsg: ChatMessage = { id: (Date.now() + 1).toString(), senderId: 'omni', text: result.text, timestamp: new Date().toISOString(), isAI: true, groundingLinks: result.links };
    setLocalMessages(prev => [...prev, aiMsg]);
    setIsTyping(false);
    onSend(userText, result.links); 
  };

  const bgColor = theme === 'dark' ? 'bg-[#0f172a] border-white/10' : 'bg-white border-slate-200';
  const textColor = theme === 'dark' ? 'text-white' : 'text-slate-900';

  return (
    <div className={`absolute top-0 right-0 w-96 h-full shadow-2xl z-[70] flex flex-col border-l animate-in slide-in-from-right duration-300 ${bgColor}`}>
      <div className={`p-4 flex items-center justify-between shrink-0 ${theme === 'dark' ? 'bg-indigo-600/90' : 'bg-indigo-600'} text-white`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center text-lg">🤖</div>
          <div>
            <h3 className="font-bold text-sm leading-none">Omni Search</h3>
            <p className="text-[10px] opacity-70 mt-1">Grounded Family Intel</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-white/10 rounded-full transition-colors"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg></button>
      </div>

      <div ref={scrollRef} className={`flex-1 overflow-y-auto p-4 space-y-4 ${theme === 'dark' ? 'bg-slate-950/50' : 'bg-slate-50'}`}>
        {localMessages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.isAI ? 'items-start' : 'items-end'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm shadow-sm ${msg.isAI ? (theme === 'dark' ? 'bg-slate-900 border-white/5 text-slate-200' : 'bg-white text-slate-800') : 'bg-indigo-600 text-white'}`}>
              {msg.text}
              {msg.groundingLinks?.map((link, idx) => (
                <a key={idx} href={link.uri} target="_blank" rel="noopener noreferrer" className="mt-2 block px-2 py-1 bg-indigo-500/20 text-indigo-300 rounded-lg text-[10px] border border-indigo-500/30 truncate">🔗 {link.title}</a>
              ))}
            </div>
          </div>
        ))}
        {isTyping && <div className="flex justify-start"><div className="bg-slate-800 rounded-2xl px-3 py-2 flex gap-1"><div className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce" /><div className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce [animation-delay:-.15s]" /><div className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce [animation-delay:-.3s]" /></div></div>}
      </div>

      <div className={`p-4 border-t shrink-0 ${theme === 'dark' ? 'bg-slate-900 border-white/5' : 'bg-white border-slate-100'}`}>
        <div className="flex gap-2">
          <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSend()} placeholder="Ask anything..." className={`flex-1 border rounded-xl px-4 py-2 text-sm outline-none ${theme === 'dark' ? 'bg-slate-800 border-white/10 text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`} />
          <button onClick={handleSend} disabled={!inputText.trim() || isTyping} className="p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all"><svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg></button>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
