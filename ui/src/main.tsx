/* <reference types="solid-js" /> */
import { render } from 'solid-js/web';
import { App } from './App';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('#root element not found in index.html');

// Clear fallback "loading..." before Solid mounts.
// Solid's render() appends to root — doesn't replace existing children.
// Emptying the root first ensures the fallback text disappears.
root.replaceChildren();

render(() => <App />, root);