import { createRoot } from 'react-dom/client';
import { App } from './App';
import './task.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<App />);
}
