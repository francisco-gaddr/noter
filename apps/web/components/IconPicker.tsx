import React from 'react';
import * as FaIcons from 'react-icons/fa';
import { useTranslation } from 'react-i18next';

interface IconPickerProps {
    onSelect: (iconName: string, color?: string) => void;
    onClose: () => void;
    currentColor?: string;
}

const ICON_KEYS = [
    'FaBriefcase', 'FaDesktop', 'FaCode', 'FaTerminal', 'FaFileCode', 'FaClipboardList', 'FaTasks',
    'FaChartLine', 'FaChartBar', 'FaChartPie', 'FaMoneyBill', 'FaDollarSign', 'FaEuroSign',
    'FaBuilding', 'FaIndustry', 'FaWarehouse', 'FaTools', 'FaWrench', 'FaCog', 'FaCogs',
    'FaUtensils', 'FaCoffee', 'FaPizzaSlice', 'FaHamburger', 'FaIceCream', 'FaAppleAlt', 'FaCarrot',
    'FaBreadSlice', 'FaCheese', 'FaEgg', 'FaFish', 'FaWineBottle', 'FaWineGlass', 'FaBeer',
    'FaCookie', 'FaCandyCane', 'FaBirthdayCake', 'FaMortarPestle', 'FaBlender',
    'FaHome', 'FaCouch', 'FaBed', 'FaBath', 'FaShower', 'FaToilet', 'FaTv', 'FaRadio', 'FaHeadphones',
    'FaMusic', 'FaGuitar', 'FaDrum', 'FaGamepad', 'FaDice', 'FaChess', 'FaBook', 'FaBookOpen',
    'FaBookReader', 'FaGraduationCap', 'FaPalette', 'FaPaintBrush', 'FaCamera', 'FaVideo',
    'FaCalendar', 'FaCalendarAlt', 'FaCalendarCheck', 'FaCalendarDay', 'FaClock', 'FaStopwatch',
    'FaHourglass', 'FaBell', 'FaAlarmClock', 'FaCheckCircle', 'FaCheckSquare', 'FaList',
    'FaListAlt', 'FaListOl', 'FaListUl', 'FaClipboard', 'FaClipboardCheck', 'FaStickyNote',
    'FaMoneyBillWave', 'FaCreditCard', 'FaPiggyBank', 'FaWallet', 'FaHandHoldingUsd', 'FaCoins',
    'FaGem', 'FaShoppingCart', 'FaShoppingBag', 'FaStore', 'FaTag', 'FaReceipt', 'FaCalculator',
    'FaChartArea', 'FaExchangeAlt', 'FaPercent',
    'FaRunning', 'FaWalking', 'FaHiking', 'FaBiking', 'FaSwimmer', 'FaDumbbell', 'FaWeight',
    'FaHeartbeat', 'FaHeart', 'FaLungs', 'FaBasketballBall', 'FaFootballBall', 'FaBaseballBall',
    'FaVolleyballBall', 'FaTennisBall', 'FaGolfBall', 'FaSkating', 'FaSkiing', 'FaSnowboarding',
    'FaSearch', 'FaSearchDollar', 'FaSearchLocation', 'FaMicroscope', 'FaFlask', 'FaAtom',
    'FaDna', 'FaBrain', 'FaBookMedical', 'FaPills', 'FaSyringe', 'FaFirstAid', 'FaHospital',
    'FaClinicMedical', 'FaUserMd', 'FaStethoscope', 'FaXRay', 'FaAllergies',
    'FaHeart', 'FaHeartbeat', 'FaLungs', 'FaBrain', 'FaEye', 'FaEar', 'FaTooth', 'FaBone',
    'FaCapsules', 'FaPills', 'FaPrescriptionBottle', 'FaFirstAid', 'FaBandAid', 'FaCrutch',
    'FaProcedures', 'FaWalking', 'FaWheelchair', 'FaBlind', 'FaDeaf', 'FaSignLanguage',
    'FaSmile', 'FaGrin', 'FaGrinBeam', 'FaGrinHearts', 'FaGrinStars', 'FaGrinTears', 'FaLaugh',
    'FaKiss', 'FaGrinTongue', 'FaGrinTongueWink', 'FaGrinTongueSquint', 'FaMeh', 'FaMehBlank',
    'FaMehRollingEyes', 'FaFrown', 'FaFrownOpen', 'FaSadTear', 'FaSadCry', 'FaGift', 'FaGifts',
    'FaBirthdayCake', 'FaGlassCheers', 'FaCrown', 'FaAward', 'FaMedal', 'FaTrophy',
    'FaFile', 'FaFileAlt', 'FaFolder', 'FaFolderOpen', 'FaStar', 'FaHome', 'FaUser', 
    'FaBookmark', 'FaCheck', 'FaExclamation', 'FaInfo', 'FaQuestion', 'FaLightbulb', 
    'FaPen', 'FaTrash', 'FaImage', 'FaMap', 'FaGlobe', 'FaLock', 'FaUnlock',
    'FaBug', 'FaRocket', 'FaPuzzlePiece', 'FaCar', 'FaBus', 'FaPlane', 'FaBicycle',
    'FaLaptop', 'FaMobileAlt', 'FaTabletAlt', 'FaBookOpen', 'FaCloud', 'FaCloudUploadAlt', 
    'FaCloudDownloadAlt', 'FaComment', 'FaComments', 'FaEnvelope', 'FaPaperclip', 'FaPaperPlane',
    'FaLeaf', 'FaTree', 'FaSeedling', 'FaFire', 'FaBolt', 'FaSun', 'FaMoon', 'FaSnowflake',
    'FaAnchor', 'FaFlag', 'FaMapMarkerAlt', 'FaRoute', 'FaRoad', 'FaTrain', 'FaShip',
    'FaWifi', 'FaBluetooth', 'FaBatteryFull', 'FaRecycle', 'FaShieldAlt', 'FaKey', 'FaThumbsUp'
];

export const IconPicker: React.FC<IconPickerProps> = ({ onSelect, onClose, currentColor }) => {
    const { t } = useTranslation();
    const COLORS = ['#FF5252', '#FF9800', '#4CAF50', '#2196F3', '#9C27B0'];
    const [selectedColor, setSelectedColor] = React.useState<string>(currentColor || COLORS[0]);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-xl w-96 max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold mb-4 text-gray-900 dark:text-gray-100">{t('iconPicker.title')}</h3>
                <div className="flex items-center gap-2 mb-3">
                    {COLORS.map((c) => (
                        <button
                            key={c}
                            onClick={() => setSelectedColor(c)}
                            className="w-6 h-6 rounded-full border border-gray-300"
                            style={{ backgroundColor: c, outline: selectedColor === c ? '2px solid #000' : 'none' }}
                            title={c}
                        />
                    ))}
                </div>
                <div className="grid grid-cols-6 gap-2">
                    {ICON_KEYS.map(key => {
                        const Icon = (FaIcons as any)[key];
                        return (
                            <button
                                key={key}
                                onClick={() => onSelect(key, selectedColor)}
                                className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded flex items-center justify-center text-gray-600 dark:text-gray-300"
                                title={key}
                            >
                                <Icon size={24} color={selectedColor} />
                            </button>
                        );
                    })}
                </div>
                <button 
                    onClick={() => onSelect('', selectedColor)}
                    className="mt-4 w-full p-2 bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-200 rounded hover:bg-red-200 dark:hover:bg-red-800"
                >
                    {t('iconPicker.removeIcon')}
                </button>
            </div>
        </div>
    );
};
