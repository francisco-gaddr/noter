'use client';

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      tabs: { notes: 'Notes', tasks: 'Tasks' },
      header: { allNotes: 'All Notes', taskLists: 'Task Lists' },
      navbar: {
        topNav: 'Top navigation',
        appTitle: 'App title',
        searchPlaceholder: 'Search notes...',
        searchAria: 'Search notes',
        searchPlaceholderNotes: 'Search notes...',
        searchAriaNotes: 'Search notes',
        searchPlaceholderTasks: 'Search tasks...',
        searchAriaTasks: 'Search tasks',
        openSettings: 'Open settings',
        settingsTitle: 'Settings',
        toggleTheme: 'Toggle theme',
        logout: 'Logout'
      },
      settings: {
        title: 'Settings',
        theme: 'Theme',
        language: 'Language',
        security: 'Security',
        autoLock: 'Auto Lock',
        autoLockTimeout: 'Auto-lock timeout',
        biometrics: 'Biometrics',
        changePassword: 'Change Password',
        logout: 'Logout',
        save: 'Save',
        cancel: 'Cancel'
      },
      project: {
        label: 'Project Folder',
        allNotes: 'All Notes',
        create: 'Create Project',
        rename: 'Rename Project',
        delete: 'Delete Project'
      },
      actions: {
        newNote: 'New Note',
        newList: 'New List',
        createTask: 'Create task',
        addChild: 'Add child note',
        deleteNote: 'Delete note'
      },
      view: {
        switchToList: 'Switch to List View',
        switchToTree: 'Switch to Tree View'
      },
      sort: {
        label: 'Sort order',
        custom: 'Custom',
        updatedNewest: 'Last Modified (Newest)',
        updatedOldest: 'Last Modified (Oldest)',
        createdNewest: 'Created (Newest)',
        createdOldest: 'Created (Oldest)',
        titleAsc: 'Title A-Z',
        titleDesc: 'Title Z-A'
      },
      list: { noNotes: 'No notes yet. Click + to add one.', allTasks: 'All tasks' },
      common: {
        untitled: 'Untitled',
        language: 'Language',
        close: 'Close',
        cancel: 'Cancel',
        save: 'Save',
        delete: 'Delete',
        title: 'Title',
        description: 'Description',
        priority: 'Priority',
        dueDate: 'Due date',
        completed: 'Completed',
        processing: 'Processing...',
        loading: 'Loading...',
        error: 'An error occurred',
        minutes: 'minutes',
        seconds: 'seconds'
      },
      noteEditor: {
        selectNote: 'Select a note to start editing',
        lockedTitle: 'This note is locked',
        lockedPasswordProtected: 'This note is password protected.',
        lockedInherited: 'This note is inheritedly locked by a parent note.',
        unlockNote: 'Unlock Note',
        unlockNoteTitle: 'Unlock Note',
        setLockPasswordTitle: 'Set Lock Password',
        changeIcon: 'Change Icon',
        exportPdf: 'Export as PDF',
        exportMarkdown: 'Export as Markdown',
        removeLockConfirm: 'Remove lock from this note?',
        unlockRemovePassword: 'Unlock Note (Remove Password)',
        lockNote: 'Lock Note',
        startTyping: 'Start typing...',
        toolbar: {
          bold: 'Bold',
          italic: 'Italic',
          underline: 'Underline',
          code: 'Code',
          heading1: 'Heading 1',
          heading2: 'Heading 2',
          quote: 'Quote',
          bulletedList: 'Bulleted List',
          numberedList: 'Numbered List',
          checkList: 'Check List',
          link: 'Link',
          image: 'Image',
          video: 'Video',
          table: 'Table',
          tableAddRow: 'Add row',
          tableRemoveRow: 'Remove row',
          tableAddColumn: 'Add column',
          tableRemoveColumn: 'Remove column'
        },
        prompts: {
          linkUrl: 'Enter the URL of the link:',
          videoUrl: 'Enter the URL of the video:'
        }
      },
      passwordModal: {
        titleEnter: 'Enter Password',
        passwordRequired: 'Password is required',
        incorrectOrError: 'Incorrect password or error occurred',
        hintCreate: 'Set a password to lock this note. You will need it to view the content later.',
        placeholderCreate: 'Set password...',
        placeholderEnter: 'Enter password...',
        lockButton: 'Lock Note',
        unlockButton: 'Unlock'
      },
      iconPicker: {
        title: 'Select Icon',
        removeIcon: 'Remove Icon'
      },
      appLock: {
        title: 'App Locked',
        subtitle: 'Please enter your password to unlock.',
        passwordPlaceholder: 'Password',
        unlock: 'Unlock',
        incorrectPassword: 'Incorrect password'
      },
      auth: {
        login: 'Log in',
        register: 'Register',
        username: 'Username',
        password: 'Password',
        loading: 'Loading...',
        noAccount: "Don't have an account? Register",
        haveAccount: 'Already have an account? Log in'
      },
      validation: {
        required: 'This field is required',
        passwordLength: 'Password must be at least 6 characters'
      },
      errors: {
        createNoteFailed: 'Failed to create note. See console.',
        generic: 'An error occurred'
      },
      aria: {
        selectIcon: 'Select icon',
        expand: 'Expand',
        collapse: 'Collapse',
        newNoteButton: 'New Note',
        newListButton: 'New List',
        notesList: 'Notes',
        notesTree: 'Notes tree view',
        deleteNote: 'Delete note',
        addChildNote: 'Add child note',
        markComplete: 'Mark as complete',
        markIncomplete: 'Mark as incomplete',
        changePriority: 'Change Priority'
      },
      confirm: {
        deleteNoteTitle: 'Delete Note',
        deleteNoteMessage: 'Are you sure you want to delete this note?',
        deleteTask: 'Are you sure you want to delete this task?'
      },
      tasks: {
        header: 'Tasks',
        todo: 'To Do',
        completed: 'Completed',
        placeholder: 'Add a task...',
        noTasks: 'No tasks yet.',
        selectList: 'Select a list',
        assignToOvrigt: 'Assign to Övrigt',
        editTitle: 'Edit Task',
        viewList: 'List view',
        viewBoard: 'Board view',
        viewCalendar: 'Calendar view',
        sortToggle: 'Toggle sort order',
        sortCustom: 'Custom',
        sortNewest: 'Newest',
        sortDueDate: 'Due date',
        sortTitle: 'Title',
        sortPriority: 'Priority',
        clearNoList: 'Clear without list',
        listLabel: 'List',
        noList: 'No list',
        priority: {
          low: 'Low',
          medium: 'Medium',
          high: 'High'
        }
      }
    }
  },
  sv: {
    translation: {
      tabs: { notes: 'Anteckningar', tasks: 'Uppgifter' },
      header: { allNotes: 'Alla anteckningar', taskLists: 'Uppgiftslistor' },
      navbar: {
        topNav: 'Toppnavigering',
        appTitle: 'Apptitel',
        searchPlaceholder: 'Sök anteckningar...',
        searchAria: 'Sök anteckningar',
        searchPlaceholderNotes: 'Sök anteckningar...',
        searchAriaNotes: 'Sök anteckningar',
        searchPlaceholderTasks: 'Sök uppgifter...',
        searchAriaTasks: 'Sök uppgifter',
        openSettings: 'Öppna inställningar',
        settingsTitle: 'Inställningar',
        toggleTheme: 'Växla tema',
        logout: 'Logga ut'
      },
      settings: {
        title: 'Inställningar',
        theme: 'Tema',
        language: 'Språk',
        security: 'Säkerhet',
        autoLock: 'Automatiskt lås',
        autoLockTimeout: 'Automatisk låsning efter',
        biometrics: 'Biometri',
        changePassword: 'Byt lösenord',
        logout: 'Logga ut',
        save: 'Spara',
        cancel: 'Avbryt'
      },
      actions: {
        newNote: 'Ny anteckning',
        newList: 'Ny lista',
        createTask: 'Skapa uppgift',
        addChild: 'Lägg till underanteckning',
        deleteNote: 'Ta bort anteckning'
      },
      project: {
        label: 'Projektmapp',
        allNotes: 'Alla anteckningar',
        create: 'Skapa projekt',
        rename: 'Byt namn på projekt',
        delete: 'Ta bort projekt'
      },
      sort: {
        label: 'Sortering',
        updatedNewest: 'Senast ändrad (nyast)',
        updatedOldest: 'Senast ändrad (äldst)',
        createdNewest: 'Skapad (nyast)',
        createdOldest: 'Skapad (äldst)',
        titleAsc: 'Titel A–Ö',
        titleDesc: 'Titel Ö–A',
        custom: 'Egen'
      },
      list: { noNotes: 'Inga anteckningar ännu. Klicka + för att lägga till.', allTasks: 'Alla uppgifter' },
      common: {
        untitled: 'Namnlös',
        language: 'Språk',
        close: 'Stäng',
        cancel: 'Avbryt',
        save: 'Spara',
        delete: 'Ta bort',
        title: 'Titel',
        description: 'Beskrivning',
        priority: 'Prioritet',
        dueDate: 'Förfallodatum',
        completed: 'Klar',
        processing: 'Bearbetar...',
        loading: 'Laddar...',
        error: 'Ett fel uppstod',
        minutes: 'minuter',
        seconds: 'sekunder'
      },
      noteEditor: {
        selectNote: 'Välj en anteckning för att börja redigera',
        lockedTitle: 'Den här anteckningen är låst',
        lockedPasswordProtected: 'Den här anteckningen är lösenordsskyddad.',
        lockedInherited: 'Den här anteckningen är ärvt låst av en förälder.',
        unlockNote: 'Lås upp',
        unlockNoteTitle: 'Lås upp anteckning',
        setLockPasswordTitle: 'Sätt lösenord',
        changeIcon: 'Byt ikon',
        exportPdf: 'Exportera som PDF',
        exportMarkdown: 'Exportera som Markdown',
        removeLockConfirm: 'Ta bort lås från anteckningen?',
        unlockRemovePassword: 'Lås upp (ta bort lösenord)',
        lockNote: 'Lås anteckning',
        startTyping: 'Börja skriva...',
        toolbar: {
          bold: 'Fet',
          italic: 'Kursiv',
          underline: 'Understruken',
          code: 'Kod',
          heading1: 'Rubrik 1',
          heading2: 'Rubrik 2',
          quote: 'Citat',
          bulletedList: 'Punktlista',
          numberedList: 'Numrerad lista',
          checkList: 'Checklista',
          link: 'Länk',
          image: 'Bild',
          video: 'Video',
          table: 'Tabell',
          tableAddRow: 'Lägg till rad',
          tableRemoveRow: 'Ta bort rad',
          tableAddColumn: 'Lägg till kolumn',
          tableRemoveColumn: 'Ta bort kolumn'
        },
        prompts: {
          linkUrl: 'Ange URL för länken:',
          videoUrl: 'Ange URL för videon:'
        }
      },
      passwordModal: {
        titleEnter: 'Ange lösenord',
        passwordRequired: 'Lösenord krävs',
        incorrectOrError: 'Fel lösenord eller ett fel inträffade',
        hintCreate: 'Sätt ett lösenord för att låsa anteckningen. Du behöver det för att se innehållet senare.',
        placeholderCreate: 'Sätt lösenord...',
        placeholderEnter: 'Ange lösenord...',
        lockButton: 'Lås anteckning',
        unlockButton: 'Lås upp'
      },
      iconPicker: {
        title: 'Välj ikon',
        removeIcon: 'Ta bort ikon'
      },
      appLock: {
        title: 'Appen är låst',
        subtitle: 'Ange ditt lösenord för att låsa upp.',
        passwordPlaceholder: 'Lösenord',
        unlock: 'Lås upp',
        incorrectPassword: 'Fel lösenord'
      },
      auth: {
        login: 'Logga in',
        register: 'Registrera',
        username: 'Användarnamn',
        password: 'Lösenord',
        loading: 'Laddar...',
        noAccount: 'Har du inget konto? Registrera dig',
        haveAccount: 'Har du redan ett konto? Logga in'
      },
      validation: {
        required: 'Detta fält är obligatoriskt',
        passwordLength: 'Lösenordet måste vara minst 6 tecken'
      },
      errors: {
        createNoteFailed: 'Kunde inte skapa anteckning. Se konsolen.',
        generic: 'Ett fel inträffade'
      },
      aria: {
        selectIcon: 'Välj ikon',
        expand: 'Expandera',
        collapse: 'Minimera',
        newNoteButton: 'Ny anteckning',
        newListButton: 'Ny lista',
        notesList: 'Anteckningar',
        notesTree: 'Trädvy anteckningar',
        deleteNote: 'Ta bort anteckning',
        addChildNote: 'Lägg till underanteckning',
        markComplete: 'Markera som klar',
        markIncomplete: 'Markera som ej klar',
        changePriority: 'Ändra prioritet'
      },
      confirm: {
        deleteNoteTitle: 'Ta bort anteckning',
        deleteNoteMessage: 'Är du säker på att du vill ta bort anteckningen?',
        deleteTask: 'Är du säker på att du vill ta bort uppgiften?'
      },
      tasks: {
        header: 'Uppgifter',
        todo: 'Att göra',
        completed: 'Avslutade',
        placeholder: 'Lägg till en uppgift...',
        noTasks: 'Inga uppgifter ännu.',
        selectList: 'Välj en lista',
        assignToOvrigt: 'Koppla till Övrigt',
        editTitle: 'Redigera uppgift',
        viewList: 'Listvy',
        viewBoard: 'Tavla',
        viewCalendar: 'Kalender',
        sortToggle: 'Växla sortering',
        sort: {
          label: 'Sortering'
        },
        sortCustom: 'Egen',
        sortNewest: 'Nyast',
        sortDueDate: 'Förfallodatum',
        sortTitle: 'Titel',
        sortPriority: 'Prioritet',
        clearNoList: 'Rensa utan lista',
        listLabel: 'Lista',
        noList: 'Ingen lista',
        priority: {
          low: 'Låg',
          medium: 'Medium',
          high: 'Hög'
        },
        filter: {
          all: 'Alla',
          active: 'Aktiva',
          completed: 'Avslutade',
          today: 'Idag',
          tomorrow: 'Imorgon',
          thisWeek: 'Denna vecka',
          thisMonth: 'Denna månad',
          dateRange: 'Datumintervall'
        }
      }
    }
  }
};

const initialLng = 'sv';

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: initialLng,
    fallbackLng: 'sv',
    interpolation: { escapeValue: false }
  });

export default i18n;
