import React, { useState, useEffect } from 'react';
import { database } from '../firebase.ts';
import { ref, onValue, set, remove } from 'firebase/database';
import { createNewUser } from './auth-service.ts';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface AppUser {
  uid: string;
  username: string;
  email: string;
}

const AdminPanel: React.FC<AdminPanelProps> = ({ isOpen, onClose }) => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    setLoading(true);
    const usersRef = ref(database, 'users');
    const unsubscribe = onValue(usersRef, (snapshot) => {
      if (snapshot.exists()) {
        const usersData = snapshot.val();
        const usersList: AppUser[] = Object.keys(usersData).map(uid => ({
          uid,
          ...usersData[uid]
        }));
        setUsers(usersList);
      } else {
        setUsers([]);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [isOpen]);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newUsername.trim().length < 3) {
        setError('Kullanıcı adı en az 3 karakter olmalıdır.');
        return;
    }
    if (newPassword.length < 6) {
        setError('Şifre en az 6 karakter olmalıdır.');
        return;
    }
    setIsCreating(true);
    try {
        await createNewUser(newUsername, newPassword);
        setNewUsername('');
        setNewPassword('');
    } catch (err: any) {
        if (err.code === 'auth/email-already-in-use') {
            setError('Bu kullanıcı adı zaten mevcut.');
        } else {
            setError('Kullanıcı oluşturulamadı: ' + err.message);
        }
    } finally {
        setIsCreating(false);
    }
  };

  const handleDeleteUser = async (userToDelete: AppUser) => {
    if (userToDelete.username === 'gurkankose') {
        alert('Admin kullanıcı silinemez.');
        return;
    }
    if (window.confirm(`${userToDelete.username} kullanıcısını silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.`)) {
        try {
            // This only removes the user from our list in the RTDB.
            // The actual Auth user still exists. A cloud function is needed for full deletion.
            await remove(ref(database, `users/${userToDelete.uid}`));
        } catch (error) {
            console.error("Failed to delete user from RTDB:", error);
            alert("Kullanıcı veritabanından silinirken bir hata oluştu.");
        }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[70] p-4">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <header className="p-4 border-b border-gray-700 flex justify-between items-center">
          <h2 className="text-xl font-bold text-white">Admin Paneli - Kullanıcı Yönetimi</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">&times;</button>
        </header>

        <main className="p-6 flex-grow overflow-y-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <h3 className="text-lg font-semibold text-white mb-3">Mevcut Kullanıcılar</h3>
            <div className="overflow-auto border border-gray-700 rounded-lg max-h-96">
              <table className="w-full text-sm text-left text-gray-300">
                <thead className="text-xs text-gray-400 uppercase bg-gray-700/50 sticky top-0">
                  <tr>
                    <th scope="col" className="px-4 py-2">Kullanıcı Adı</th>
                    <th scope="col" className="px-4 py-2">E-posta</th>
                    <th scope="col" className="px-4 py-2 text-right">İşlemler</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={3} className="text-center p-4">Yükleniyor...</td></tr>
                  ) : users.length === 0 ? (
                    <tr><td colSpan={3} className="text-center p-4">Kullanıcı bulunamadı.</td></tr>
                  ) : (
                    users.map(user => (
                      <tr key={user.uid} className="bg-gray-800 border-b border-gray-700 hover:bg-gray-700/50">
                        <td className="px-4 py-2 font-semibold">{user.username}</td>
                        <td className="px-4 py-2">{user.email}</td>
                        <td className="px-4 py-2 text-right">
                          <button onClick={() => handleDeleteUser(user)} disabled={user.username === 'gurkankose'} className="text-red-500 hover:text-red-400 font-medium disabled:text-gray-500 disabled:cursor-not-allowed">Sil</button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-white mb-3">Yeni Kullanıcı Oluştur</h3>
            <form onSubmit={handleCreateUser} className="bg-gray-700/50 p-4 rounded-lg space-y-4">
                <div>
                    <label className="block text-sm text-gray-300 mb-1" htmlFor="new-username">Kullanıcı Adı</label>
                    <input type="text" id="new-username" value={newUsername} onChange={e => setNewUsername(e.target.value)} className="w-full p-2 bg-gray-900 border border-gray-600 rounded-md text-white" />
                </div>
                 <div>
                    <label className="block text-sm text-gray-300 mb-1" htmlFor="new-password">Şifre</label>
                    <input type="password" id="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full p-2 bg-gray-900 border border-gray-600 rounded-md text-white" />
                </div>
                {error && <p className="text-red-400 text-sm">{error}</p>}
                <button type="submit" disabled={isCreating} className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg transition duration-300 disabled:bg-gray-600">
                    {isCreating ? 'Oluşturuluyor...' : 'Oluştur'}
                </button>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
};

export default AdminPanel;