import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';

function Video({ uri, testID }: { uri: string; testID?: string }) {
  const player = useVideoPlayer(uri);
  // Centered portrait frame: a 9:16 clip capped at 420dp tall.
  return <VideoView player={player} style={{ height: 420, aspectRatio: 9 / 16, alignSelf: 'center' }} nativeControls contentFit="contain" testID={testID} />;
}

export function MediaPreview({ uri, mimeType, testID }: { uri: string; mimeType: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceAlt }}>
      {mimeType.startsWith('video/') ? (
        <Video uri={uri} testID={testID} />
      ) : (
        <Image source={{ uri }} cachePolicy="none" style={{ width: '100%', height: 260 }} contentFit="contain" accessibilityLabel="Evidence preview" testID={testID} />
      )}
    </View>
  );
}
