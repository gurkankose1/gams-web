import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.tsx';
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { auth } from './firebase.ts';
import { onAuthStateChanged, User, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth';

const ADMIN_EMAIL = 'gurkankose@gams.app';
const ADMIN_PASSWORD = 'Gg.113355';

const mockAdminUser = {
    uid: 'admin-auto-user',
    email: ADMIN_EMAIL,
    emailVerified: true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: '',
    tenantId: null,
    delete: async () => {},
    getIdToken: async () => '',
    getIdTokenResult: async () => ({} as any),
    reload: async () => {},
    toJSON: () => ({}),
    displayName: 'Gürkan Köse',
    phoneNumber: null,
    photoURL: null,
    providerId: 'firebase',
} as unknown as User;

const setupAndLoginAdmin = async () => {
    try {
        await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
        console.log('Admin user created successfully.');
    } catch (error: any) {
        if (error.code === 'auth/email-already-in-use') {
            console.log('Admin user already exists.');
        } else {
            console.error('Error creating admin user:', error);
        }
    }
    
    try {
        await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    } catch (err) {
        console.error('Auto login attempt error:', err);
    }
};

const AuthController: React.FC = () => {
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
            } else {
                // If firebase auth is not logged in, auto sign-in or use mock admin user directly
                signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD)
                    .then((res) => setUser(res.user))
                    .catch(() => setUser(mockAdminUser));
            }
            setLoading(false);
        });
        return () => unsubscribe();
    }, []);

    if (loading) {
        return (
            <div className="bg-gray-900 text-white h-screen flex items-center justify-center">
                <div className="text-xl">Yükleniyor...</div>
            </div>
        );
    }

    return <App user={user || mockAdminUser} />;
};

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

(async () => {
    await setupAndLoginAdmin();
    root.render(
      <React.StrictMode>
        <DndProvider backend={HTML5Backend}>
          <AuthController />
        </DndProvider>
      </React.StrictMode>
    );
})();