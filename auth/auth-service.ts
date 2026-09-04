import { 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signOut,
  UserCredential,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword
} from "firebase/auth";
import { ref, set } from "firebase/database";
import { auth, database } from "../firebase.ts";

const DOMAIN = "gams.app";

export const createNewUser = async (username: string, password: string): Promise<UserCredential> => {
    const email = `${username.toLowerCase().trim()}@${DOMAIN}`;
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Save user info to Realtime Database
    await set(ref(database, `users/${user.uid}`), {
        uid: user.uid,
        username: username.trim(),
        email: user.email,
    });

    return userCredential;
};

export const signInUser = (username: string, password: string) => {
    const loginIdentifier = username.toLowerCase().trim();
    const email = loginIdentifier.includes('@') ? loginIdentifier : `${loginIdentifier}@${DOMAIN}`;
    return signInWithEmailAndPassword(auth, email, password);
};

export const signOutUser = () => {
    return signOut(auth);
};

export const reauthenticateAndChangePassword = async (currentPassword: string, newPassword: string) => {
    const user = auth.currentUser;
    if (!user || !user.email) {
        throw new Error("Kullanıcı oturumu bulunamadı.");
    }

    const credential = EmailAuthProvider.credential(user.email, currentPassword);
    
    // Re-authenticate the user
    await reauthenticateWithCredential(user, credential);
    
    // If re-authentication is successful, update the password
    await updatePassword(user, newPassword);
};