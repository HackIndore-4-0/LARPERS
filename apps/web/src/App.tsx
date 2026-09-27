import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { EditorPage } from "./EditorPage";
import { PublicPage } from "./PublicPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<PublicPage />} />
        <Route path="/editor" element={<EditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
