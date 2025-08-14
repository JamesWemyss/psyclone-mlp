export const metadata = {
  title: 'Psyclone (MLP)',
  description: 'Minimal Lovable Psyclone — capture and ignore.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: '#fff' }}>
        {children}
      </body>
    </html>
  );
}
