import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { Providers } from './providers'
import SWRegister from '../components/SWRegister'
import StoreHydrator from '../components/StoreHydrator'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Noter',
  description: 'Secure Notes App',
  manifest: '/app/manifest.json'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="sv" suppressHydrationWarning>
      <body className={inter.className} suppressHydrationWarning>
        <Providers>
            <StoreHydrator />
            <SWRegister />
            <div id="root-app">
              {children}
            </div>
        </Providers>
      </body>
    </html>
  )
}
