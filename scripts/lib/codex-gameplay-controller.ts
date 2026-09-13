// Shared fixed virtual-input controller; the standalone service and ordinary
// PI Desktop acceptance controller use identical event/release semantics.
export {createGameplayController,validateInputSegment,type InputSegment} from '../../vendor/pi-desktop/apps/desktop/electron/main/headless-gameplay-controller';
