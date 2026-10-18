import type {Metadata} from 'next';
export const metadata:Metadata={title:'社会科ナゾトキ教室',description:'ひとりの知識が、みんなのひらめきになる。班で協力する社会科クイズ。'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ja"><body style={{margin:0}}>{children}</body></html>;}
