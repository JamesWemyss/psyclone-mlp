export const metadata = {
  title: 'Psyclone',
  description: 'Minimal chat shell for Psyclone Assistant',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#fff' }}>{children}</body>
    </html>
  );
}
