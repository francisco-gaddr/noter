import React from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Modal, Portal, Text, Button, useTheme, IconButton } from 'react-native-paper';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';

interface IconPickerModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (icon: string, color?: string) => void;
  currentIcon?: string;
  currentColor?: string;
}

const COMMON_ICONS = [
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
  'FaFolder', 'FaFolderOpen', 'FaFile', 'FaFileAlt', 'FaFilePdf', 'FaFileImage',
  'FaStar', 'FaHeart', 'FaBookmark', 'FaFlag', 'FaHome', 'FaUser', 'FaUsers',
  'FaCheck', 'FaCheckCircle', 'FaCheckSquare', 'FaTimes', 'FaTimesCircle',
  'FaExclamation', 'FaExclamationCircle', 'FaExclamationTriangle',
  'FaInfo', 'FaInfoCircle', 'FaQuestion', 'FaQuestionCircle',
  'FaSearch', 'FaLock', 'FaUnlock', 'FaKey', 'FaTrash', 'FaTrashAlt', 'FaEdit', 'FaPen',
  'FaPlus', 'FaMinus', 'FaArrowRight', 'FaArrowLeft', 'FaCode', 'FaTerminal',
  'FaLaptop', 'FaMobile', 'FaTablet', 'FaBook', 'FaBookOpen', 'FaGraduationCap',
  'FaMoneyBill', 'FaCreditCard', 'FaShoppingCart', 'FaPlane', 'FaCar', 'FaBicycle', 'FaBus',
  'FaMusic', 'FaVideo', 'FaCamera', 'FaImage', 'FaSmile', 'FaFrown', 'FaMeh'
];

export default function IconPickerModal({ visible, onDismiss, onSelect, currentIcon, currentColor }: IconPickerModalProps) {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = React.useState('');
  const COLORS = ['#FF5252', '#FF9800', '#4CAF50', '#2196F3', '#9C27B0'];
  const [selectedColor, setSelectedColor] = React.useState(currentColor || COLORS[0]);

  const toFa5 = (faKey: string) => {
    const name = faKey.startsWith('Fa') ? faKey.substring(2) : faKey;
    return name
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .toLowerCase();
  };

  const filteredIcons = React.useMemo(() => {
    if (!searchQuery) return COMMON_ICONS;
    return COMMON_ICONS.filter(icon => 
      icon.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [searchQuery]);

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
        <Text variant="titleMedium" style={styles.title}>Välj ikon</Text>
        
        <TextInput
          placeholder="Sök ikon..."
          placeholderTextColor={theme.colors.onSurfaceVariant}
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={[styles.searchBar, { color: theme.colors.onSurface, borderColor: theme.colors.outline }]}
          autoCorrect={false}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          importantForAutofill="no"
        />

        <ScrollView style={styles.grid} contentContainerStyle={styles.gridContent}>
          <View style={styles.row}>
            {filteredIcons.map((icon) => {
                const fa5Name = toFa5(icon);
                return (
                    <TouchableOpacity
                        key={icon}
                        style={[
                            styles.iconItem,
                            currentIcon === icon && { backgroundColor: theme.colors.primaryContainer }
                        ]}
                        onPress={() => onSelect(icon, selectedColor)}
                    >
                        <FontAwesome5 
                            name={fa5Name as any} 
                            size={24} 
                            color={selectedColor} 
                        />
                    </TouchableOpacity>
                );
            })}
          </View>
        </ScrollView>
        
        <View style={styles.colorRow}>
          {COLORS.map((c) => (
            <TouchableOpacity
              key={c}
              style={[
                styles.colorDot,
                { backgroundColor: c },
                selectedColor === c ? styles.colorDotSelected : null
              ]}
              onPress={() => setSelectedColor(c)}
            />
          ))}
        </View>
        
        <Button onPress={onDismiss} style={styles.closeButton}>Stäng</Button>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modalContent: {
    padding: 20,
    margin: 20,
    borderRadius: 8,
    maxHeight: '80%',
  },
  title: {
    textAlign: 'center',
    marginBottom: 16,
  },
  searchBar: {
    marginBottom: 16,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
  },
  grid: {
    flexGrow: 1,
  },
  gridContent: {
    paddingBottom: 16,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 16,
  },
  colorRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    marginTop: 12,
    marginBottom: 8,
  },
  colorDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  colorDotSelected: {
    borderWidth: 2,
    borderColor: '#000',
  },
  iconItem: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  closeButton: {
    marginTop: 8,
  },
});
