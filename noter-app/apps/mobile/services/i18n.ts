import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';

const resources = {
  en: {
    translation: {
      common: {
        title: 'Title',
        cancel: 'Cancel',
        save: 'Save',
        delete: 'Delete',
        edit: 'Edit',
        close: 'Close',
        loading: 'Loading...',
        error: 'Error',
        success: 'Success',
        untitled: 'Untitled',
        language: 'Language',
        theme: 'Theme',
        appearance: 'Appearance',
        security: 'Security',
        account: 'Account',
        logout: 'Logout',
        notifications: 'Notifications',
        developer: 'Developer',
        version: 'Version',
        buildId: 'Build ID',
      },
      note: {
        new: 'New Note',
        edit: 'Edit Note',
        deleteConfirmTitle: 'Delete Note',
        deleteConfirmMessage: 'Are you sure you want to delete this note?',
        locked: 'Locked Note',
        unlock: 'Unlock Note',
        lock: 'Lock Note',
        removeLock: 'Remove Lock',
        setPassword: 'Set Password',
        enterPassword: 'Enter Password',
        passwordPlaceholder: 'Password',
        incorrectPassword: 'Incorrect password',
      },
      settings: {
        title: 'Settings',
        autoLock: 'Auto-lock',
        pushNotifications: 'Push Notifications',
        backendUrl: 'Backend URL',
        changeLanguage: 'Change Language',
      }
    },
  },
  sv: {
    translation: {
      common: {
        title: 'Titel',
        cancel: 'Avbryt',
        save: 'Spara',
        delete: 'Ta bort',
        edit: 'Redigera',
        close: 'Stäng',
        loading: 'Laddar...',
        error: 'Fel',
        success: 'Lyckades',
        untitled: 'Namnlös',
        language: 'Språk',
        theme: 'Tema',
        appearance: 'Utseende',
        security: 'Säkerhet',
        account: 'Konto',
        logout: 'Logga ut',
        notifications: 'Notiser',
        developer: 'Utvecklare',
        version: 'Version',
        buildId: 'Build ID',
      },
      note: {
        new: 'Ny anteckning',
        edit: 'Redigera anteckning',
        deleteConfirmTitle: 'Ta bort anteckning',
        deleteConfirmMessage: 'Är du säker på att du vill ta bort denna anteckning?',
        locked: 'Låst anteckning',
        unlock: 'Lås upp',
        lock: 'Lås anteckning',
        removeLock: 'Ta bort lås',
        setPassword: 'Välj lösenord',
        enterPassword: 'Ange lösenord',
        passwordPlaceholder: 'Lösenord',
        incorrectPassword: 'Fel lösenord',
      },
      settings: {
        title: 'Inställningar',
        autoLock: 'Autolås',
        pushNotifications: 'Push-notiser',
        backendUrl: 'Backend URL',
        changeLanguage: 'Byt språk',
      }
    },
  },
};

const initI18n = async () => {
  const savedLanguage = await AsyncStorage.getItem('language');
  const locale = Localization.getLocales()[0]?.languageCode;
  const language = savedLanguage || (locale === 'sv' ? 'sv' : 'en');

  i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: language,
      fallbackLng: 'en',
      interpolation: {
        escapeValue: false,
      },
    });
};

initI18n();

export default i18n;
