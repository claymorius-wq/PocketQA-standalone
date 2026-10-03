import { DMMono_400Regular } from '@expo-google-fonts/dm-mono/400Regular';
import { DMMono_500Medium } from '@expo-google-fonts/dm-mono/500Medium';
import { InstrumentSans_400Regular } from '@expo-google-fonts/instrument-sans/400Regular';
import { InstrumentSans_600SemiBold } from '@expo-google-fonts/instrument-sans/600SemiBold';
import { RedHatDisplay_300Light } from '@expo-google-fonts/red-hat-display/300Light';
import { RedHatDisplay_400Regular } from '@expo-google-fonts/red-hat-display/400Regular';
import { RedHatDisplay_500Medium } from '@expo-google-fonts/red-hat-display/500Medium';
import { fontFamilies } from './tokens';

// Per-weight subpath imports: each package's index requires every weight, and Metro would bundle
// all of them as assets.
export const LENS_FONTS = {
  [fontFamilies.display300]: RedHatDisplay_300Light,
  [fontFamilies.display400]: RedHatDisplay_400Regular,
  [fontFamilies.display500]: RedHatDisplay_500Medium,
  [fontFamilies.ui400]: InstrumentSans_400Regular,
  [fontFamilies.ui600]: InstrumentSans_600SemiBold,
  [fontFamilies.mono400]: DMMono_400Regular,
  [fontFamilies.mono500]: DMMono_500Medium,
};
