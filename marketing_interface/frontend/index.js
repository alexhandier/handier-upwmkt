import {initializeBlock} from '@airtable/blocks/interface/ui';
import './style.css';
import App from './App';

initializeBlock({interface: () => <App />});
