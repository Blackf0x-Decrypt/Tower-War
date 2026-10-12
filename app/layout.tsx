import type { Metadata } from 'next';
import { Bitter, Rubik } from 'next/font/google';
import './globals.css';

const bitter = Bitter({
  variable: '--font-bitter',
  subsets: ['latin', 'cyrillic'],
  weight: ['700', '800', '900'],
});

const rubik = Rubik({
  variable: '--font-rubik',
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700', '800', '900'],
});

export const metadata: Metadata = {
  title: 'Forge of Will — Солнечная долина',
  description:
    'Захватывайте башни и отправляйте отряды. Свободный цвет может занять друг. Пустой цвет к старту играет бот.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru">
      <body className={`${bitter.variable} ${rubik.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
