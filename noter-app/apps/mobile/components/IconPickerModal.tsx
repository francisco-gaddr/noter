import React from 'react';
import { StyleSheet, View, ScrollView, TouchableOpacity } from 'react-native';
import { Modal, Portal, Text, Button, useTheme, IconButton, Searchbar } from 'react-native-paper';
import FontAwesome5 from '@expo/vector-icons/FontAwesome5';

interface IconPickerModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (icon: string, color?: string) => void;
  currentIcon?: string;
  currentColor?: string;
}

const COMMON_ICONS = [
  'FaFolder', 'FaFolderOpen', 'FaFile', 'FaFileAlt', 'FaFileCode', 'FaFileImage', 'FaFilePdf',
  'FaBriefcase', 'FaClipboard', 'FaClipboardList', 'FaList', 'FaListAlt', 'FaListUl', 'FaListOl',
  'FaCheck', 'FaCheckCircle', 'FaCheckSquare', 'FaTimes', 'FaTimesCircle',
  'FaExclamation', 'FaExclamationCircle', 'FaExclamationTriangle',
  'FaInfo', 'FaInfoCircle', 'FaQuestion', 'FaQuestionCircle',
  'FaStar', 'FaHeart', 'FaBookmark', 'FaFlag',
  'FaHome', 'FaUser', 'FaUsers', 'FaCog', 'FaCogs', 'FaWrench',
  'FaCalendar', 'FaCalendarAlt', 'FaClock', 'FaBell',
  'FaSearch', 'FaLock', 'FaUnlock', 'FaKey',
  'FaTrash', 'FaTrashAlt', 'FaEdit', 'FaPen',
  'FaPlus', 'FaMinus', 'FaArrowRight', 'FaArrowLeft',
  'FaCode', 'FaTerminal', 'FaLaptop', 'FaMobile', 'FaTablet',
  'FaBook', 'FaBookOpen', 'FaGraduationCap',
  'FaChartBar', 'FaChartPie', 'FaChartLine',
  'FaMoneyBill', 'FaCreditCard', 'FaShoppingCart',
  'FaPlane', 'FaCar', 'FaBicycle', 'FaBus',
  'FaMusic', 'FaVideo', 'FaCamera', 'FaImage',
  'FaSmile', 'FaFrown', 'FaMeh',
  'FaDatabase', 'FaServer', 'FaCloud', 'FaNetworkWired',
  'FaCodeBranch', 'FaBug', 'FaMicrochip', 'FaRobot',
  'FaBrain', 'FaAtom', 'FaDna', 'FaSyringe',
  'FaPills', 'FaFirstAid', 'FaHospital', 'FaStethoscope',
  'FaUniversity', 'FaSchool', 'FaBookReader',
  'FaChalkboardTeacher', 'FaMicroscope', 'FaFlask', 'FaVial',
  'FaGlobe', 'FaMap', 'FaMapMarker', 'FaMapSigns',
  'FaCompass', 'FaRoute', 'FaTrafficLight', 'FaRoad',
  'FaSubway', 'FaTrain', 'FaTram', 'FaBusAlt',
  'FaTaxi', 'FaCarSide', 'FaTruck', 'FaMotorcycle',
  'FaShip', 'FaAnchor', 'FaRocket', 'FaSpaceShuttle',
  'FaSun', 'FaMoon', 'FaCloudSun', 'FaCloudRain',
  'FaSnowflake', 'FaBolt', 'FaWind', 'FaWater',
  'FaFire', 'FaLeaf', 'FaTree', 'FaSeedling',
  'FaPaw', 'FaDog', 'FaCat', 'FaHorse',
  'FaFish', 'FaCrow', 'FaDragon', 'FaGhost',
  'FaGamepad', 'FaDice', 'FaChess', 'FaPuzzlePiece',
  'FaTrophy', 'FaMedal', 'FaAward', 'FaCrown',
  'FaGift', 'FaBirthdayCake', 'FaGlassCheers', 'FaCocktail',
  'FaCoffee', 'FaMugHot', 'FaBeer', 'FaWineGlass',
  'FaUtensils', 'FaHamburger', 'FaPizzaSlice', 'FaIceCream',
  'FaAppleAlt', 'FaCarrot', 'FaPepperHot', 'FaLemon',
  'FaHeart', 'FaHeartbeat', 'FaMedkit', 'FaStethoscope',
  'FaDumbbell', 'FaRunning', 'FaWalking', 'FaSwimmer',
  'FaBiking', 'FaHiking', 'FaFutbol', 'FaBasketballBall',
  'FaYinYang', 'FaSpa', 'FaWallet', 'FaPiggyBank',
  'FaCoins', 'FaReceipt', 'FaTags', 'FaShoppingBag'
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

export default function IconPickerModal({ visible, onDismiss, onSelect, currentIcon, currentColor }: IconPickerModalProps) {
  const theme = useTheme();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedColor, setSelectedColor] = React.useState(currentColor);
  const [selectedIcon, setSelectedIcon] = React.useState(currentIcon);

  React.useEffect(() => {
    setSelectedColor(currentColor);
  }, [currentColor]);

  React.useEffect(() => {
    setSelectedIcon(currentIcon);
  }, [currentIcon]);

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

  const handleConfirm = () => {
      if (selectedIcon) {
          onSelect(selectedIcon, selectedColor);
      } else {
          onDismiss();
      }
  };

  return (
    <Portal>
      <Modal visible={visible} onDismiss={onDismiss} contentContainerStyle={[styles.modalContent, { backgroundColor: theme.colors.surface }]}>
        <Text variant="titleMedium" style={styles.title}>Välj ikon</Text>
        
        <Searchbar
          placeholder="Sök ikon..."
          onChangeText={setSearchQuery}
          value={searchQuery}
          style={styles.searchBar}
          autoCorrect={false}
          autoCapitalize="none"
        />

        <View style={styles.colorRow}>
            {COLORS.map(color => (
                <TouchableOpacity 
                    key={color} 
                    style={[
                        styles.colorItem, 
                        { backgroundColor: color }, 
                        selectedColor === color && { borderWidth: 2, borderColor: theme.colors.onSurface }
                    ]} 
                    onPress={() => setSelectedColor(color)}
                />
            ))}
            <TouchableOpacity 
                    style={[
                        styles.colorItem, 
                        { backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.colors.outline }, 
                        !selectedColor && { borderWidth: 2, borderColor: theme.colors.onSurface }
                    ]} 
                    onPress={() => setSelectedColor(undefined)}
            >
                <View style={{ width: '100%', height: 1, backgroundColor: theme.colors.error, transform: [{ rotate: '45deg' }] }} />
            </TouchableOpacity>
        </View>

        <ScrollView style={styles.grid} contentContainerStyle={styles.gridContent}>
          <View style={styles.row}>
            {filteredIcons.map((icon) => {
                const fa5Name = toFa5(icon);
                const isSelected = selectedIcon === icon;
                return (
                    <TouchableOpacity
                        key={icon}
                        style={[
                            styles.iconItem,
                            isSelected && { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary, borderWidth: 2 }
                        ]}
                        onPress={() => setSelectedIcon(icon)}
                    >
                        <FontAwesome5 
                            name={fa5Name as any} 
                            size={24} 
                            color={isSelected && selectedColor ? selectedColor : (isSelected ? theme.colors.primary : theme.colors.onSurface)} 
                        />
                    </TouchableOpacity>
                );
            })}
          </View>
        </ScrollView>
        
        <View style={styles.footer}>
            <Button onPress={onDismiss} style={styles.button}>Avbryt</Button>
            <Button mode="contained" onPress={handleConfirm} style={styles.button}>Välj</Button>
        </View>
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
    flex: 1,
  },
  title: {
    textAlign: 'center',
    marginBottom: 16,
  },
  searchBar: {
    marginBottom: 16,
    height: 40,
  },
  colorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
    justifyContent: 'center',
  },
  colorItem: {
    width: 32,
    height: 32,
    borderRadius: 16,
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
  iconItem: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  footer: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: 8,
      gap: 8,
  },
  button: {
      minWidth: 80,
  }
});
