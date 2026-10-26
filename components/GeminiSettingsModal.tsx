import React, { useState, useEffect } from 'react';
import {
    getStoredApiKey,
    setStoredApiKey,
    getStoredModel,
    setStoredModel,
    AVAILABLE_MODELS,
    testGeminiConnection,
    ConnectionTestResult,
    DEFAULT_API_KEY
} from '../services/gemini-api.ts';

interface GeminiSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    onKeyUpdated?: () => void;
}

export const GeminiSettingsModal: React.FC<GeminiSettingsModalProps> = ({
    isOpen,
    onClose,
    onKeyUpdated
}) => {
    const [apiKey, setApiKey] = useState<string>('');
    const [selectedModel, setSelectedModel] = useState<string>('gemini-3.6-flash');
    const [isTesting, setIsTesting] = useState<boolean>(false);
    const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
    const [showKey, setShowKey] = useState<boolean>(false);
    const [saveSuccess, setSaveSuccess] = useState<boolean>(false);

    useEffect(() => {
        if (isOpen) {
            setApiKey(getStoredApiKey());
            setSelectedModel(getStoredModel());
            setTestResult(null);
            setSaveSuccess(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSave = () => {
        setStoredApiKey(apiKey);
        setStoredModel(selectedModel);
        setSaveSuccess(true);
        onKeyUpdated?.();
        setTimeout(() => setSaveSuccess(false), 2500);
    };

const handleTest = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            const res = await testGeminiConnection(apiKey, selectedModel);
            setTestResult(res);
        } catch (err: any) {
            setTestResult({
                success: false,
                model: selectedModel,
                latencyMs: 0,
                error: err.message || 'Bilinmeyen hata oluştu.'
            });
        } finally {
            setIsTesting(false);
        }
    };

    const handleResetDefault = () => {
        setApiKey('');
        setSelectedModel('gemini-3.6-flash');
        setStoredApiKey('');
        setStoredModel('gemini-3.6-flash');
        onKeyUpdated?.();
    };

return (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-[100] p-4 backdrop-blur-md animate-fade-in select-none">
            <div className="bg-gray-900 border border-purple-500/40 rounded-2xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden text-white">
                
                {/* Header */}
                <header className="p-4 bg-gradient-to-r from-purple-950 via-slate-900 to-indigo-950 border-b border-purple-500/30 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center text-xl shadow-lg shadow-purple-600/30">
                            🔑
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h2 className="text-lg font-bold text-white tracking-wide">Gemini API Ayarları</h2>
                                <span className="text-[10px] uppercase font-extrabold px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40">
                                    Google Pro / AI Studio
                                </span>
                            </div>
                            <p className="text-xs text-purple-200/70">
                                Kişisel Google Gemini API anahtarınızı güvenle yönetin.
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-gray-800 transition"
                    >
                        ✕
                    </button>
                </header>

                {/* Body */}
                <div className="p-5 space-y-4 text-sm">
                    {/* Security Notice */}
                    <div className="p-3 bg-purple-950/40 border border-purple-800/40 rounded-xl flex items-start gap-2.5 text-xs text-purple-200">
                        <span className="text-base">🛡️</span>
                        <div>
                            <span className="font-semibold text-purple-300">Gizlilik & Güvenlik:</span> API anahtarınız sunuculara veya veritabanına yüklenmez. Yalnızca tarayıcınızın yerel belleğinde (localStorage) saklanır ve doğrudan Google sunucularıyla haberleşir.
                        </div>
                    </div>

                    {/* API Key Input */}
                    <div>
                        <div className="flex justify-between items-center mb-1.5">
                            <label className="text-xs font-semibold text-gray-300">
                                Google Gemini API Key
                            </label>
                            <button
                                type="button"
                                onClick={() => setShowKey(!showKey)}
                                className="text-[11px] text-purple-400 hover:text-purple-300"
                            >
                                {showKey ? 'Gizle' : 'Göster'}
                            </button>
                        </div>
                        <input
                            type={showKey ? 'text' : 'password'}
                            value={apiKey}
                            onChange={(e) => setApiKey(e.target.value)}
                            placeholder="AIzaSy... veya AQ...."
                            className="w-full bg-gray-950 border border-gray-700 focus:border-purple-500 rounded-lg px-3 py-2 text-sm text-gray-200 font-mono outline-none transition"
                        />
                        <div className="flex justify-between items-center mt-1 text-[11px] text-gray-400">
                            <span>Google Pro hesabınızla AI Studio'dan alınmıştır.</span>
                            <a
                                href="https://aistudio.google.com/app/apikey"
                                target="_blank"
                                rel="noreferrer"
                                className="text-indigo-400 hover:underline inline-flex items-center gap-1"
                            >
                                Yeni Key Al ↗
                            </a>
                        </div>
                    </div>

                    {/* Model Selector */}
                    <div>
                        <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                            Kullanılacak Model
                        </label>
                        <select
                            value={selectedModel}
                            onChange={(e) => setSelectedModel(e.target.value)}
                            className="w-full bg-gray-950 border border-gray-700 focus:border-purple-500 rounded-lg px-3 py-2 text-sm text-gray-200 outline-none transition"
                        >
                            {AVAILABLE_MODELS.map(m => (
                                <option key={m.id} value={m.id}>
                                    {m.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Test Results Display */}
                    {testResult && (
                        <div className={`p-3 rounded-xl border text-xs ${
                            testResult.success 
                                ? 'bg-emerald-950/40 border-emerald-600/50 text-emerald-300' 
                                : 'bg-rose-950/40 border-rose-600/50 text-rose-300'
                        }`}>
                            <div className="flex items-center justify-between font-semibold mb-1">
                                <span>{testResult.success ? '✅ Bağlantı Başarılı!' : '❌ Bağlantı Başarısız!'}</span>
                                <span className="text-[10px] text-gray-400">{testResult.latencyMs} ms ({testResult.model})</span>
                            </div>
                            {testResult.success ? (
                                <div className="italic text-gray-300">
                                    "{testResult.reply}"
                                </div>
                            ) : (
                                <div className="space-y-2">
                                    <div>Hata: {testResult.error}</div>
                                    {(testResult.error?.includes('high demand') || testResult.error?.includes('503')) && (
                                        <div className="p-2.5 bg-amber-950/60 border border-amber-600/50 rounded-lg text-amber-200 text-xs">
                                            <div className="font-bold flex items-center gap-1.5 text-amber-300">
                                                <span>ℹ️</span>
                                                <span>Google Sunucularında Yoğunluk</span>
                                            </div>
                                            <p className="mt-1 text-[11px] text-amber-200/90 leading-relaxed">
                                                Google, <strong>{testResult.model}</strong> için şu an geçici bir talep yoğunluğu bildiriyor.
                                                Kesintisiz çalışmak için en kararlı model olan <strong>Gemini Flash Lite</strong>'ı seçebilirsiniz:
                                            </p>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedModel('gemini-flash-lite-latest');
                                                    setStoredModel('gemini-flash-lite-latest');
                                                }}
                                                className="mt-2 px-3 py-1 bg-amber-500 hover:bg-amber-400 text-gray-950 font-bold rounded text-xs transition"
                                            >
                                                👉 Gemini Flash Lite Modelini Seç
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <footer className="p-4 bg-gray-950/80 border-t border-gray-800 flex items-center justify-between">
                    <button
                        type="button"
                        onClick={handleResetDefault}
                        className="text-xs text-gray-400 hover:text-gray-200 underline"
                    >
                        Varsayılana Sıfırla
                    </button>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleTest}
                            disabled={isTesting || !apiKey.trim()}
                            className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-gray-800 hover:bg-gray-700 text-purple-300 border border-purple-500/30 transition disabled:opacity-40"
                        >
                            {isTesting ? 'Test Ediliyor...' : '⚡ Bağlantıyı Test Et'}
                        </button>

                        <button
                            type="button"
                            onClick={handleSave}
                            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-md shadow-purple-600/20 transition"
                        >
                            {saveSuccess ? '✓ Kaydedildi!' : 'Kaydet'}
                        </button>
                    </div>
                </footer>
            </div>
        </div>
    );
};

export default GeminiSettingsModal;
