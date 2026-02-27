export interface Note {
  _id: string;
  userId: string;
  title: string;
  content: string;
  tags: string[];
  parentId: string | null;
  locked: boolean;
  password?: string;
  icon?: string;
  iconColor?: string;
  order?: number;
  type?: 'note' | 'task_list' | 'project';
  clientId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateNoteDto {
  clientId?: string;
  title: string;
  content: string;
  tags?: string[];
  parentId?: string | null;
  locked?: boolean;
  password?: string;
  icon?: string;
  iconColor?: string;
  order?: number;
  type?: 'note' | 'task_list' | 'project';
}

export interface UpdateNoteDto {
  title?: string;
  content?: string;
  tags?: string[];
  parentId?: string | null;
  locked?: boolean;
  password?: string;
  icon?: string;
  iconColor?: string;
  order?: number;
  type?: 'note' | 'task_list' | 'project';
}

export interface Task {
  _id: string;
  userId: string;
  clientId?: string;
  title: string;
  description: string;
  dueDate: string | null;
  completed: boolean;
  priority: 'low' | 'medium' | 'high';
  parentNoteId: string | null;
  parentId?: string | null; // For subtasks
  position?: number;
  createdAt: string;
  updatedAt: string;
}

export interface EncryptedTask {
  _id: string;
  userId: string;
  title: string;
  description: string;
  dueDate: string | null;
  completed: string; // Encrypted boolean string
  priority: string; // Encrypted priority string
  parentNoteId: string | null;
  parentId?: string | null;
  position?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTaskDto {
  clientId?: string;
  title: string;
  description?: string;
  dueDate?: string | null;
  completed?: boolean;
  priority?: 'low' | 'medium' | 'high';
  parentNoteId?: string | null;
  parentId?: string | null;
  position?: number;
}

export interface UpdateTaskDto {
  title?: string;
  description?: string;
  dueDate?: string | null;
  completed?: boolean;
  priority?: 'low' | 'medium' | 'high';
  parentNoteId?: string | null;
  parentId?: string | null;
  position?: number;
}

export interface User {
  _id: string;
  username: string;
  createdAt: string;
}

export const ICON_LIST = [
  // General
  'FaBriefcase', 'FaDesktop', 'FaCode', 'FaTerminal', 'FaFileCode', 'FaClipboardList', 'FaTasks',
  'FaChartLine', 'FaChartBar', 'FaChartPie', 'FaMoneyBill', 'FaDollarSign', 'FaEuroSign',
  'FaBuilding', 'FaIndustry', 'FaWarehouse', 'FaTools', 'FaWrench', 'FaCog', 'FaCogs',
  
  // Food
  'FaUtensils', 'FaCoffee', 'FaPizzaSlice', 'FaHamburger', 'FaIceCream', 'FaAppleAlt', 'FaCarrot',
  'FaBreadSlice', 'FaCheese', 'FaEgg', 'FaFish', 'FaWineBottle', 'FaWineGlass', 'FaBeer',
  'FaCookie', 'FaCandyCane', 'FaBirthdayCake', 'FaMortarPestle', 'FaBlender',

  // Lifestyle & Home
  'FaHome', 'FaCouch', 'FaBed', 'FaBath', 'FaShower', 'FaToilet', 'FaTv', 'FaRadio', 'FaHeadphones',
  'FaMusic', 'FaGuitar', 'FaDrum', 'FaGamepad', 'FaDice', 'FaChess', 'FaBook', 'FaBookOpen',
  'FaBookReader', 'FaGraduationCap', 'FaPalette', 'FaPaintBrush', 'FaCamera', 'FaVideo',

  // Planning & Time
  'FaCalendar', 'FaCalendarAlt', 'FaCalendarCheck', 'FaCalendarDay', 'FaClock', 'FaStopwatch',
  'FaHourglass', 'FaBell', 'FaAlarmClock', 'FaCheckCircle', 'FaCheckSquare', 'FaList',
  'FaListAlt', 'FaListOl', 'FaListUl', 'FaClipboard', 'FaClipboardCheck', 'FaStickyNote',

  // Economy
  'FaMoneyBillWave', 'FaCreditCard', 'FaPiggyBank', 'FaWallet', 'FaHandHoldingUsd', 'FaCoins',
  'FaGem', 'FaShoppingCart', 'FaShoppingBag', 'FaStore', 'FaTag', 'FaReceipt', 'FaCalculator',
  'FaChartArea', 'FaExchangeAlt', 'FaPercent',

  // Training & Sports
  'FaRunning', 'FaWalking', 'FaHiking', 'FaBiking', 'FaSwimmer', 'FaDumbbell', 'FaWeight',
  'FaHeartbeat', 'FaHeart', 'FaLungs', 'FaBasketballBall', 'FaFootballBall', 'FaBaseballBall',
  'FaVolleyballBall', 'FaTennisBall', 'FaGolfBall', 'FaSkating', 'FaSkiing', 'FaSnowboarding',

  // Research & Science
  'FaSearch', 'FaSearchDollar', 'FaSearchLocation', 'FaMicroscope', 'FaFlask', 'FaAtom',
  'FaDna', 'FaBrain', 'FaBookMedical', 'FaPills', 'FaSyringe', 'FaFirstAid', 'FaHospital',
  'FaClinicMedical', 'FaUserMd', 'FaStethoscope', 'FaXRay', 'FaAllergies',

  // Health
  'FaCapsules', 'FaPrescriptionBottle', 'FaBandAid', 'FaCrutch',
  'FaProcedures', 'FaWheelchair', 'FaBlind', 'FaDeaf', 'FaSignLanguage',

  // Joy & Emotions
  'FaSmile', 'FaGrin', 'FaGrinBeam', 'FaGrinHearts', 'FaGrinStars', 'FaGrinTears', 'FaLaugh',
  'FaKiss', 'FaGrinTongue', 'FaGrinTongueWink', 'FaGrinTongueSquint', 'FaMeh', 'FaMehBlank',
  'FaMehRollingEyes', 'FaFrown', 'FaFrownOpen', 'FaSadTear', 'FaSadCry', 'FaGift', 'FaGifts',
  'FaGlassCheers', 'FaCrown', 'FaAward', 'FaMedal', 'FaTrophy',

  // Files & Misc
  'FaFolder', 'FaFolderOpen', 'FaFile', 'FaFileAlt', 'FaFilePdf', 'FaFileImage',
  'FaStar', 'FaBookmark', 'FaFlag', 'FaUser', 'FaUsers',
  'FaCheck', 'FaTimes', 'FaExclamation', 'FaInfo', 'FaQuestion',
  'FaLock', 'FaUnlock', 'FaKey', 'FaTrash', 'FaEdit', 'FaPen',
  'FaPlus', 'FaMinus', 'FaArrowRight', 'FaArrowLeft',
  'FaLaptop', 'FaMobile', 'FaTablet', 'FaPlane', 'FaCar', 'FaBus', 'FaBicycle'
];

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  createdAt: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  model?: string;
}

export interface AIModel {
  id: string;
  name: string;
  filename: string;
  path: string;
  size: number;
  quantization?: string;
  downloaded: boolean;
}

export interface MCPService {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  config: Record<string, any>;
}

export interface AuthResponse {
  user: User;
  token: string;
}

export * from './encrypt';
