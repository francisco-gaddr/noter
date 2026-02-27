import React from 'react';
import * as FaIcons from 'react-icons/fa';
import { useTranslation } from 'react-i18next';

interface IconPickerProps {
    onSelect: (iconName: string, iconColor?: string) => void;
    onClose: () => void;
}

// Extended list of icons categorized roughly
// We'll keep a flat list for simplicity but ensure variety as requested
const ICON_KEYS = [
    // General / Work / Office
    'FaFolder', 'FaFolderOpen', 'FaBriefcase', 'FaLaptop', 'FaBuilding', 'FaChartBar', 'FaChartPie', 'FaCalculator',
    'FaCalendar', 'FaClock', 'FaPaperclip', 'FaFileAlt', 'FaArchive', 'FaAddressBook', 'FaIdCard', 'FaPhone',
    
    // Food / Drink
    'FaUtensils', 'FaCoffee', 'FaBeer', 'FaWineGlass', 'FaCocktail', 'FaAppleAlt', 'FaHamburger', 'FaPizzaSlice',
    'FaIceCream', 'FaCookie', 'FaFish', 'FaCarrot', 'FaBreadSlice', 'FaMugHot',
    
    // Lifestyle / Home / Family
    'FaHome', 'FaUser', 'FaUsers', 'FaChild', 'FaBaby', 'FaBed', 'FaBath', 'FaCouch', 'FaTv',
    'FaMusic', 'FaCamera', 'FaVideo', 'FaGamepad', 'FaBook', 'FaPaw', 'FaDog', 'FaCat',
    
    // Health / Fitness / Sport
    'FaHeart', 'FaHeartbeat', 'FaMedkit', 'FaStethoscope', 'FaDumbbell', 'FaRunning', 'FaWalking', 'FaSwimmer',
    'FaBiking', 'FaHiking', 'FaFutbol', 'FaBasketballBall', 'FaYinYang', 'FaSpa',
    
    // Finance / Money
    'FaMoneyBill', 'FaCreditCard', 'FaWallet', 'FaPiggyBank', 'FaCoins', 'FaReceipt', 'FaTags', 'FaShoppingBag',
    'FaShoppingCart', 'FaGifts',
    
    // Travel / Transport
    'FaPlane', 'FaCar', 'FaBus', 'FaTrain', 'FaSubway', 'FaShip', 'FaBicycle', 'FaMotorcycle',
    'FaMap', 'FaMapMarkerAlt', 'FaGlobe', 'FaSuitcase', 'FaPassport', 'FaHotel',
    
    // Research / Education / Tech
    'FaGraduationCap', 'FaUniversity', 'FaMicroscope', 'FaFlask', 'FaAtom', 'FaDna', 'FaBrain', 'FaLightbulb',
    'FaCode', 'FaTerminal', 'FaBug', 'FaRobot', 'FaDatabase', 'FaServer', 'FaWifi', 'FaMobileAlt',
    
    // Joy / Misc
    'FaSmile', 'FaGrin', 'FaLaugh', 'FaStar', 'FaSun', 'FaMoon', 'FaCloud', 'FaBolt', 'FaFire',
    'FaLeaf', 'FaTree', 'FaSeedling', 'FaSnowflake', 'FaUmbrella', 'FaAnchor', 'FaRocket'
];

const COLORS = [
    '#000000', // Default/Black
    '#EF4444', // Red
    '#F59E0B', // Orange
    '#10B981', // Green
    '#3B82F6', // Blue
    '#8B5CF6', // Purple
    '#EC4899', // Pink
];

export const IconPicker: React.FC<IconPickerProps> = ({ onSelect, onClose }) => {
    const { t } = useTranslation();
    const [selectedColor, setSelectedColor] = React.useState(COLORS[0]);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-xl w-[500px] max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t('iconPicker.title')}</h3>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">✕</button>
                </div>
                
                <div className="mb-4 flex gap-2 justify-center">
                    {COLORS.map(color => (
                        <button
                            key={color}
                            onClick={() => setSelectedColor(color)}
                            className={`w-8 h-8 rounded-full border-2 ${selectedColor === color ? 'border-gray-900 dark:border-white scale-110' : 'border-transparent'}`}
                            style={{ backgroundColor: color }}
                            title={color}
                        />
                    ))}
                </div>

                <div className="flex-1 overflow-y-auto min-h-0">
                    <div className="grid grid-cols-8 gap-2 p-1">
                        {ICON_KEYS.map(key => {
                            const Icon = (FaIcons as any)[key];
                            if (!Icon) return null;
                            return (
                                <button
                                    key={key}
                                    onClick={() => onSelect(key, selectedColor)}
                                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center justify-center transition-colors"
                                    title={key}
                                >
                                    <Icon size={24} color={selectedColor} />
                                </button>
                            );
                        })}
                    </div>
                </div>
                
                <button 
                    onClick={() => onSelect('')}
                    className="mt-4 w-full p-2 bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-200 rounded hover:bg-red-200 dark:hover:bg-red-800"
                >
                    {t('iconPicker.removeIcon')}
                </button>
            </div>
        </div>
    );
};
