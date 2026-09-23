/* <reference types="solid-js" /> */
import { render } from 'solid-js/web';
import { App } from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found in index.html');

render(() => <App />, root);