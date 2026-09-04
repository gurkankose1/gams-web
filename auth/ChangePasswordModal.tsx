import React, { useState } from 'react';
import { reauthenticateAndChangePassword } from './auth-service.ts';

interface ChangePasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ChangePasswordModal: React.FC<ChangePasswordModalProps> = ({ isOpen, onClose }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const resetForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setError('');
    setSuccess('');
    setLoading(false);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (newPassword !== confirmPassword) {
      setError('Yeni şifreler eşleşmiyor.');
      return;
    }
    if (newPassword.length < 6) {
      setError('Yeni şifre en az 6 karakter olmalıdır.');
      return;
    }

    setLoading(true);
    try {
      await reauthenticateAndChangePassword(currentPassword, newPassword);
      setSuccess('Şifreniz başarıyla değiştirildi!');
      setTimeout(() => {
        handleClose();
      }, 2000);
    } catch (err: any) {
      if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError('Mevcut şifreniz yanlış.');
      } else {
        setError('Bir hata oluştu. Lütfen tekrar deneyin.');
        console.error(err);
      }
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[80] p-4">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-md">
        <header className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">Şifre Değiştir</h2>
          <button onClick={handleClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
        </header>

        <form onSubmit={handleChangePassword}>
          <main className="p-6 space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-1" htmlFor="current-password">Mevcut Şifre</label>
              <input type="password" id="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required className="w-full p-2 bg-gray-900 border border-gray-600 rounded-md text-white" />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1" htmlFor="new-password">Yeni Şifre</label>
              <input type="password" id="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required className="w-full p-2 bg-gray-900 border border-gray-600 rounded-md text-white" />
            </div>
            <div>
              <label className="block text-sm text-gray-300 mb-1" htmlFor="confirm-password">Yeni Şifre (Tekrar)</label>
              <input type="password" id="confirm-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required className="w-full p-2 bg-gray-900 border border-gray-600 rounded-md text-white" />
            </div>
            {error && <p className="text-red-400 text-sm">{error}</p>}
            {success && <p className="text-green-400 text-sm">{success}</p>}
          </main>

          <footer className="p-4 bg-gray-900/50 border-t border-gray-700 flex justify-end space-x-3">
            <button type="button" onClick={handleClose} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-4 rounded-lg transition duration-300">
              İptal
            </button>
            <button type="submit" disabled={loading} className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 disabled:bg-gray-600">
              {loading ? 'Değiştiriliyor...' : 'Değiştir'}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
};

export default ChangePasswordModal;