import { mountApp } from './app';
import { installNativeBack } from './native-back';

const app = document.getElementById('app');
if (app) mountApp(app);
installNativeBack();
