# Ödeme Takip ve Tahsilat Raporu

Finans menüsünün güncel kapsamı yalnız **Ödeme Takip** ve **Tahsilat Raporu** modülleridir. Genel Yönetim Raporu, Şirket Ödeme Planı, Finans Paneli ve ham Logo veri gezgini; sayfaları, menüleri, API kayıtları ve özel test/yardımcılarıyla uygulamadan kaldırılmıştır. `/finance` Ödeme Takip ekranına yönlenir. İki ekranın LOGO_DND bağlantısı, ödeme kaynağı denetimleri, takip kayıtları, DND ve boş yetki kodu başlangıç filtreleri korunur. Kaldırılan kodun geri alınabilir kopyası `output/finance-prune-2026-10-03/archive` altındadır.

Yerel ekran: `/finance/payment-tracking`. Ayrı finans menüsü öğesi; yönetici ve muhasebe erişebilir. Preview erişimi kapalıdır.

## Çalışma biçimi

Liste müşteri–daire–döviz bazında takip dosyaları sunar. Ekran varsayılan olarak **Normal satış** türündeki, takip zamanı gelmiş açık dosyaları açar. Asıl vadeye göre gecikmiş, ertelenmiş, bugün, gelecek ve kapanmış dosyalar ayrıca filtrelenir. Arama, proje, sorumlu, bana atanan, atanmamış, yüksek öncelik, sıralama ve 25/50/100 dosyalık sayfalama vardır.

İlk görünümde arama, kısa uygulanmış kapsam, döviz bazında gecikmiş ödeme özeti ve dosya listesi bulunur. **Filtreler** ile **Yönetim özeti** başlangıçta kapalıdır; kullanıcı istediğinde açar. Filtre panelini açıp kapatmak taslağı veya etkin seçimi değiştirmez ve veri isteği göndermez. Genişletilmiş filtreler geçersiz değer varsa otomatik açılır; kapatılırsa kısa hata uyarısı kalır. Yönetim özetinde açık bakiye kartları, takip durumu sayıları, tamamen ödenenlere erişim ve kaynak zamanı bulunur. Kaynak hatası/eskimesi ve eksik tutar uyarıları kapalı panelin arkasına gizlenmez.

### Gelişmiş filtreler

**Filtreler** paneli açıldığında ödeme türü düğmeleri görünür: Normal satış, Arsa, KDV, Trafo, Eşya, Depozito, Diğer, Tümü. Bir düğmeye basınca seçim hemen uygulanır; sayfa 1 olur ve önceki tekil Logo kayıt kodu filtresi temizlenir. Ana satırda proje, satış temsilcisi, para birimi, arama, Yetki Kodu ve takip durumu vardır; yüzlerce daire kodundan oluşan eski Proje seçimi gelişmiş filtrelerde **Logo kayıt kodu** adıyla yer alır. Yetki Kodu ana filtre satırındadır. Ana seçimde **“Yetki Kodu boş — Gerçek müşteriler”** seçeneği bulunur; bu seçim `authorizationState=blank` uygular ve önceki kod seçimini temizler. Tüm kodlara veya belirli bir koda dönüldüğünde boş kod filtresi kaldırılır. Sınıflandırma kullanıcının iş kuralına dayanır; dosyada hem boş hem dolu kod varsa ayrı “kodlu ve boş kayıt birlikte” durumunda kalır. Gelişmiş filtrelerde şu alanlar bulunur:

- Yetki Kodu durumu: kodu olan, tamamen boş, kodlu ve boş kayıt birlikte, eşleşmeyen, birden fazla kodlu.
- Emlakçı kodu, cari kodu ve daire kodu; satış temsilcisi ana filtrelerdedir.
- En eski açık vade, güncel takip tarihi ve fatura tarihi için başlangıç/bitiş aralıkları.
- Kaynak gecikme günü, dosyanın açık bakiyesi ve gecikmiş tutarı için en düşük/en yüksek değerler.
- Ödeme durumu: ödenmemiş, kısmen ödenmiş, kapanmış, belirsiz; yerel takip kaydı var/yok; erteleme tarihi var/yok; veri tam/eksik.

Sıralama: kaynak/takip gecikme günü, kalan/toplam/ödenen/gecikmiş tutar, takip/en eski açık/sonraki vade, müşteri ve daire adı. Her iki yön desteklenir; bilinmeyen değerler en sonda kalır.

**Ödeme türü filtresi önce ödeme satırlarını seçer**; listedeki plan, ödenen, kalan, gecikmiş tutar, taksit sayısı ve vadeler yalnız seçilen türe göre hesaplanır. Diğer filtreler bu sonuçtan **dosya seçer**. Dosyanın sabit anahtarı korunur. Tümü seçilirse orijinal dosya tutarları gösterilir. Aynı dosyada en az bir eşleşen kod/temsilci/emlakçı bulunması yeterlidir; farklı alanlar dosya üzerinde birlikte uygulanır, aynı taksiti tarif ettikleri iddia edilmez. Fatura tarihi aralığı iki sınırı da sağlayan en az bir fatura tarihi arar. Vade aralığı dosyanın en eski açık vadesine, takip aralığı etkin takip tarihine uygulanır. Yerel erteleme filtresi geçmişte kalmış tarihleri de içerir; “ertelenmiş” durum sekmesi yalnız etkin ertelemeleri seçer.

Aralık uçları dahildir. Sıfır etkin bir filtre değeridir; boş giriş filtresizdir. Eksik finans verisi olan dosyalar tutar/gecikme günü aralıklarına dahil edilmez. Para aralıkları yalnız tek döviz seçiliyken uygulanır. Tüm para birimleri seçiliyken tutar alanları devre dışıdır; API bu kapsamda tutar aralığını açık hata ile reddeder. Döviz değişimi yalnız para aralıklarını temizler ve kullanıcıya bildirir; gün ve tarih aralıkları korunur. Seçenekler seçili döviz kapsamı ve ödeme türünün bütün dosyalarından üretilir; diğer filtreler seçenekleri gizlemez. Seçimler URL'de tutulur, sayfalama ve detaydan geri dönüşte korunur; etkin filtreler tek tek veya topluca kaldırılabilir.

Filtrelerin altında **“Filtrelenen toplam gecikmiş ödeme”** gösterilir. Bu tutar Yetki Kodu (boş dahil), proje, sorumlu, tarihler, tutarlar ve **takip durumu dahil bütün uygulanmış filtrelere** göre hesaplanır. Yalnız açık sayfadaki 25/50/100 satırın toplamı değildir; tüm eşleşen dosyaların kaynak gecikmiş bakiyesini kapsar. Filtresi uygulanmamış taslak alanlar sonucu değiştirmez. Tek dövizde seçili döviz açıkça yazılır; tüm dövizlerde her para biriminin gecikmiş toplamı ayrı gösterilir. Ertelenen dosyanın kaynak gecikmesi korunur. Eksik veri varsa tutar bilinen alt toplam olarak belirtilir; tamamen bilinmeyen tutar sıfır gösterilmez.

Yeni girişte **Yetki Kodu boş** varsayılan seçilidir. URL'de açıkça seçilmiş yetki durumu korunur; eski linkte yalnız belirli `authorizationCode` varsa boş kod filtresi eklenmez. Boş kod filtresinin çipini kaldırmak veya **Temizle** işlemi tüm yetki kodlarını gösterir.

**Satış temsilcisi** seçimi ana filtrelerde projenin yanındadır ve seçim hemen uygulanır. Aynı formdaki proje, ödeme türü, yetki kodu ve diğer filtreler korunur; hatalı tarih/tutar aralığı varsa önce düzeltilmesi gerekir. Temsilci `LOGO_DND.dbo.L_223_FATURA_VADE.SE_KODU` alanından tam müşteri/daire/döviz eşleşmesiyle gelir; yerel takip sorumlusu değildir. Bir dosyada birden fazla temsilci varsa her biriyle bulunabilir. Seçenekler seçili döviz ve ödeme türünün kaynak dosyalarından oluşur; proje/yetki seçimiyle sonuçlar birlikte daralır. **Tüm satış temsilcileri** veya ilgili filtre çipini kaldırmak temsilci kısıtını temizler.

Her dosyada kaynak ödeme satırları, vade sırası, ödenen/kalan tutarlar ve gecikme günleri bulunur. Erteleme gerekçeyle kaydedilir; görevlinin takip tarihi değişir. **Logo vadesi, ödeme planı, borç veya ödenen tutar değiştirilmez.** Ertelenen dosya takip sırası gelene kadar ayrı listede kalırken kaynak gecikmesi ve gecikmiş bakiye görünür kalır. Erteleme kaldırılabilir. Ödendi işareti elle verilmez; durum kaynaktan okunur.

Not, sorumlu kişi, normal/yüksek öncelik ve kullanıcı tarafından bildirilen telefon/e-posta/WhatsApp görüşme kayıtları aynı dosyada tutulur. Geçmişte kim, ne zaman, neden ve hangi tarih değişikliğini yaptı bilgisi bulunur. Son 100 olay gösterilir; daha fazla olay varsa belirtilir, eski olaylar silinmez.

E-posta ve WhatsApp düğmeleri düzenlenebilir alıcı/mesaj önizlemesi açar. Gönderim kullanıcının harici uygulamasındadır; modül kendi başına mesaj göndermez. Taslak açmak gönderim sayılmaz ve görüşme geçmişine otomatik kayıt düşmez. Kullanıcı isterse gerçekleşen görüşmeyi ayrıca kaydeder. Elle girilen iletişim adresi kalıcı olarak saklanmaz.

## Kaynak ve kimlik — LOGO_DND

Finans kaynağı `[LOGO_DND].[dbo].[L_223_ODEME_PLANI]`: `CARİ KOD`, `CARİ ADI`, `DAİRE`, `DAİRE ADI`, `PROJE KOD`, `VADE`, `DVZ`, `TUTAR`, `ODENEN`. Bu modül Crm_DND veritabanını okumaz. Bağlantı, rapor ürünlerinden bağımsız `LogoDatabaseModule` tarafından sağlanır; yalnız SELECT sorguları kabul edilir. Modüle özel katalog her okumada bağlantı veritabanını, gerçek VIEW nesnesini ve gereken kolon türlerini doğrular. Aynı adlı tablo veya synonym kabul edilmez.

`[LOGO_DND].[dbo].[L_223_FATURA_VADE]` yalnız ek dosya bilgilerini sağlar: fatura yetki kodu `YETKİ_KODU`, temsilci `SE_KODU`, emlakçı `BROKER`, fatura tarihi `FAT TARİHİ`. Cari, daire ve döviz kodları tam eşitlikle karşılaştırılır; bilgiler Set olarak dosyaya eklenir. İki view finansal sorguda JOIN edilmez, ayrıntı satırları ödeme planının tutarını çoğaltmaz. Fatura-vade view'ı ödeme planından farklı tutar kapsamına sahip olduğundan ikinci finans kaynağı olarak toplanmaz. `L_223_ODEME_PLANI_KDV` de ana plana eklenmez; örtüşen kayıtlar vardır.

Boş yetki kodu, eşleşmeyen dosya ve okunamayan kaynak ayrı durumlardır. Tamamen boş kod filtresi `matched && hasBlank && codes.length === 0` koşulunu kullanır; boş ve dolu kod birlikte bulunan dosyaları almaz. Fatura ayrıntıları okunamazsa finans verisi uyarıyla sunulur. Etkin yetki kodu, temsilci, emlakçı veya fatura tarihi filtresi açık 503 döndürür; filtre sessizce atlanmaz ve eski metadata kullanılmaz.

Dosya anahtarı `payment-tracking-case-logo-v2`, `LOGO_DND`, `dbo`, firma 223, dönem 1 ve tam cari/daire/döviz kodları dizisinin SHA256 değeridir. CRM CustomerId/ApartmentId alanları kullanılmaz. İsim, vade, tutar, ödenen, view satır sırası ve LOGICALREF kimliğe dahil değildir. Plan LOGICALREF değerlerinin çoğu sıfırdır; bu alan üzerinden tekilleştirme yapılmaz. Kaynak satırları korunur. Proje adı planda bulunmadığından uydurulmaz; proje kodu gösterilir.

Cari, daire veya döviz kodu eksik dosyalar salt okunur gösterilir. Kod değiştiğinde önceki takip kaydı otomatik başka dosyaya taşınmaz; kaynağı bulunamayan takip dosyası sayısı gösterilir. Geçiş öncesi 2 Ekim 2026 salt okunur kontrolde saklanmış dosya/olay sayısı 0/0 idi; kayıt silme veya geçmiş taşıma işlemi yapılmadı. Eski kaynak anahtarları yeniden üretilmez.

İletişim bilgileri `[LOGO_DND].[dbo].[L_223_OZET_SATIS]` içindeki `MAIL` ve `TELEFON` alanlarından, parametreli sorgu ve tam cari kodu eşitliğiyle okunur. Aynı iletişimi tekrarlayan satırlar kabul edilir; farklı e-posta/telefon adayları veya 100 satır sınırının aşılması belirsiz sayılır. Yaklaşık isim/kod eşleştirmesi ve başka veritabanına geri dönüş yoktur. Eksik veya belirsiz sonuçta görevli alıcıyı kendisi girer.

## Finans kapsamı

- Para birimi filtresinde tek döviz veya **Tüm para birimleri** seçilir. Tümünde dosyalar ortak listede görünür, parasal özetler her döviz için ayrı tutulur. GBP, EUR, USD, TL ve bilinmeyen dövizler birbirine eklenmez; kur dönüşümü yoktur. Tutar sıralaması bu görünümde önce döviz gruplarını, sonra her grubun kendi tutar sırasını kullanır. Tamamen ödenen dosyaların `scope=all` durumunda en sona gelme kuralı korunur.
- Kalan, her kaynak satırı için pozitif `TUTAR - ODENEN` değeridir. Orijinal gecikme, açık satırın VADE tarihinin Asia/Famagusta gününden önce olmasıyla hesaplanır.
- Eksik tutar sıfır sayılmaz. Bilinen alt toplamlar mevcut rapor semantiğiyle gösterilir; `incompleteRows` eksiklik işaretidir. Tamamen bilinmeyen toplam null kalır.
- Görünen parasal özetler ve kapsam sayıları seçili döviz ve takip durumu dahil tüm filtrelerin kapsamındadır; sayfalamadan bağımsızdır (`filteredSummary`). Yalnız durumlar arasında gezinmek için kullanılan KPI sayıları takip durumu seçilmeden önceki portföyü korur (`summary`). “Takip sırasındaki dosyaların açık bakiyesi” gelecekteki taksitler dahil bu dosyaların toplam açık bakiyesidir. Asıl vadeye göre gecikmiş tutar ayrıca gösterilir.
- Kaynak satır sayısı taksit veya fatura tekilliği iddiası değildir; müşteri–daire dosyası sayısından farklıdır.

## Saklama ve güvenlik

Supabase migration: `20260929180000_payment_tracking`.

- `PaymentTrackingCase`: yalnız kaynak referansı, yerel takip tarihi, sorumlu, öncelik, sürüm ve değişiklik bilgileri.
- `PaymentTrackingEvent`: not/gerekçe, işlem türü, eski/yeni takip tarihi, işlem yapan ve zaman.
- Finans satırları Supabase'ye kopyalanmaz. Tam kaynak dökümü yalnız sunucu belleğinde tutulur: ilk 30 saniye taze, en fazla 5 dakika yaşındaki sonuç ise zaman damgasıyla gösterilirken arka planda yenilenir. Normal liste/detay okumaları devam eden yenilemeyi beklemez. Aynı anda gelen yenilemeler tek kaynak okumasını paylaşır; başarısız arka plan okumasında 15 saniye yeniden deneme beklenir. Gün değiştiğinde veya azami yaş aşıldığında eski sonuç sunulmaz. Manuel yenileme ve takip değişikliği öncesinde güncel SQL sonucu beklenir; hata halinde eski veriyle işlem yapılmaz.
- Finans ve Yetki Kodu view okumaları bağımsız ve eşzamanlıdır; her biri çalışma anında VIEW/kolon doğrulamasını ve satır sınırını korur. Liste için SQL Server okuması ile Supabase takip bilgileri birlikte yüklenir; Supabase okumaları kendi içinde sıralıdır ve sunucuda takip kayıtları önbelleğe alınmaz. Detay iletişim okuması da takip/geçmiş okumalarıyla paraleldir. Sorumlu seçenekleri 30 saniye paylaşılır; manuel yenileme ve işlem sonrası bu süre beklenmez. Atanan kişinin aktif rolü yazma anında ayrıca doğrulanır.
- Kaynak sorgusu 25.001 satır kontrol eder; 25.000 sınırı aşılırsa eksik liste sunmak yerine açık hata döndürür. Tarayıcıya yalnız seçili sayfa, detayda ise ilgili dosyanın satırları gönderilir.
- `expectedVersion` zorunludur. Eşzamanlı değişiklik 409 döndürür; kayıt ve geçmiş tek transaction içinde yazılır. UI taslağı korur ve güncel dosyayı yükletir.
- İşlem yapan/atanan kişinin aktif yönetici veya muhasebe hesabı olması yazma anında da doğrulanır.
- İki tabloda RLS açık, public/anon/authenticated doğrudan erişimi kapalıdır; mevcut API veritabanı rolü üzerinden erişilir.

## API

- `GET /payment-tracking`: liste, döviz seçenekleri ve özetler. `summary` durum navigasyonu için durum filtresinden önce; `filteredSummary` bütün liste filtrelerinden sonra ve sayfalamadan önce hesaplanır. İkisinde de null/eksik bilgi semantiği korunur; ayrıca SQL sorgusu çalıştırılmaz.
- Liste `currency=__ALL__` ile bütün dövizleri kapsar; `currency=__NULL__` yalnız dövizi belirsiz dosyalardır. Yanıt `currencyMode: single|all` ve `currencyBreakdown: {currency,total,summary,filteredSummary}[]` içerir. Tüm döviz modunda `selectedCurrency=null`, üst özetlerin üç para alanı (`outstanding`, `overdueAmount`, `actionableAmount`) null, sayım alanları tüm sonuçların sayısıdır. Breakdown mevcut döviz seçeneklerini içerir; tek döviz modunda seçilmemiş dövizlerin özeti sıfırdır. Breakdown toplamları sayfalama öncesidir. Döviz kapsamı ve ayrımı tarayıcıda yanıt/önbellek kabulünden önce doğrulanır.
- `GET /payment-tracking/:key`: kaynak satırları, takip durumu, iletişim ve geçmiş. `refresh=true` güncel kaynaktan zorunlu yeniler.
- `POST /payment-tracking/:key/actions`: `defer`, `reset`, `note`, `assign`, `priority`, `contact`.

İstemciden tutar, ödeme durumu veya kaynak kimliği kabul edilmez. Tarih ertelemesi bugünden ve kaynak dosyanın en eski açık vadesinden ileri olmalıdır. Finans kaynağı okunamazsa yerel değişiklik uygulanmaz.

Liste ve detayın `source.freshness` alanı `fresh`, `refreshing` veya `stale` durumunu ve `retryAfterMs` değerini bildirir; `generatedAt` son başarılı finans okumasının zamanıdır. Önbellek erişimi bu zamanı ilerletmez. Arka plan yenilemesi tamamlandığında finans ve Yetki bilgileri tek sonuç olarak değiştirilir; eski kodlar yeni finans verisine taşınmaz. Kaynak erişim hatası sırasında yakın tarihli sonuç açık uyarıyla gösterilebilir, hatalı okuma boş portföye dönüştürülmez.

## Önceki kaynak için arşiv doğrulaması — 29 Eylül 2026

Aşağıdaki sayılar eski CRM view kaynağına aittir; LOGO_DND geçişinin kabul ölçümü değildir.

- Backend: 258 test geçti (91 kaynak, 27 saklama, 77 iş akışı/yetki, 63 gelişmiş filtre). Paralel başlangıç, tek yenileme, 30/300 saniye sınırları, hata beklemesi, gece yarısı, zorunlu okuma başarısızlığında yazma engeli ve boş Yetki Kodu semantiği korunuyor. Filtrelenen toplamlar için bütün takip durumları, birleşik filtreler, üç sayfa boyunca değişmeyen toplam, döviz ayrımı, null/eksik veri ve boş sonuçlar ayrıca doğrulandı.
- API uygulama TypeScript kontrolü, yeni backend/frontend dosyalarının ESLint kontrolü ve tüm web TypeScript kontrolü geçti. Genel backend test tip kontrolünde önceden var olan Digital Team/Logo test fixture hataları bu çalışmanın dışında kaldı.
- Tarayıcı testi 46 taklit istek ve 7 taklit işlemle geçti: filtre/sıralama/sayfalama, erteleme/geri alma, sürüm çakışmasında taslak koruma, atama/öncelik/not/görüşme, kaynak erişim hatası, Preview engeli ve masaüstü/mobil açık-koyu görünüm. Yetki ve gelişmiş filtre kombinasyonları, sıfır aralık değeri, URL/geri/yenileme koruması, boş kod seçimi, tek filtre kaldırma, hatalı aralık kontrolü ve yetki kaynağı kesintisinden filtre temizleyerek çıkış doğrulandı. Arka plan kontrolü ekranı kilitlemez; taslaklar korunur, dil değişimi yeni veri isteği göndermez, gizli sekmede kontrol durur. En az 3 saniye arayla en fazla 10 normal okuma/60 saniye yapılır; kaynak veya filtre değişimi eski isteği iptal eder. İletişim önizlemesinin POST göndermediği, eksik veride kesin tutar mesajı üretmediği ve WhatsApp telefon kontrolü doğrulandı. Test: `web/tests/payment-tracking.browser.cjs`.
- Önceki canlı finans kontrolü: 14.119 satır, 845 dosya, salt okunur kimlik sorunu olan dosya yok. Dört para biriminin tutar/ödenen/kalan/gecikmiş toplamları SQL kaynağıyla karşılaştırılarak doğrulandı. İlk finans kaynağı okuması o denemede 8,4 saniye sürdü; bu tüm ekranın açılma süresi değildir. Yeni Yetki Kodu eşleştirmesi ve filtre doğrulamasının güncel süre/sayıları bağlantılı canlı okuma kanıtındadır.
- Gelişmiş filtrelerin canlı kontrolü: 845 dosyanın tamamı yetki kaynağıyla eşleşti; 136 dosyada kod var, 709 dosyada kod boş. Dört dövizde kod seçenekleri/adetleri, birleşik kod-müşteri-daire-temsilci-emlakçı-fatura-bakiye filtreleri ve dosya tutarlarının korunması doğrulandı. Dört dövizin kaynak toplamları yeniden uzlaştırıldı. Kod ve boş kod/durum filtrelerinin bütün sonuçlara ait gecikmiş toplamları ayrıca kaynak dosyalarından hesaplanarak karşılaştırıldı. Güncel okuma süresi canlı kontrol kanıtındadır; sonraki okumalar yukarıdaki sınırlı arka plan yenileme politikasını kullanır.
- Canlı detay ve mevcut CRM üzerinden tekil cari kodla iletişim eşleştirme kontrolü geçti. Gerçek müşteriye mesaj gönderilmedi.
- Supabase migration uygulandı. RLS, rol yetkileri ve kısıtlar kontrol edildi. Sentetik kayıtlarla yapılan transaction testi ROLLBACK edildi; öncesi/sonrası dosya ve olay sayısı 0/0 kaldı.
- Anonim gerçek API çağrısı HTTP 401 döndü.
- Uygulama değişiklikleri yerelde çalışır; ayrı production web/API dağıtımı yapılmadı.

Kanıtlar: [canlı okuma](payment-tracking-live-verification.json), [Supabase kontrolü](payment-tracking-store-verification.json). Salt okunur tekrar kontrolü: `api/` altında `npx ts-node -r tsconfig-paths/register scripts/verify-payment-tracking.ts`.

## Önceki kaynak için arşiv performans ölçümleri

`scripts/profile-payment-tracking.ts baseline|optimized` servis düzeyinde gerçek kaynakla yalnız okuma yapar. Kaynak tutarları veya müşteri kimlikleri kanıta yazılmaz. Ölçüm sayfanın bütün tarayıcı yükleme süresi değildir.

| İşlem | Önce | Sonra |
| --- | ---: | ---: |
| 35 saniye sonra boş Yetki Kodu filtresi | 13.631 ms | 636 ms |
| Taze veride aynı filtre | 630 ms | 963 ms |
| Taze veride detay | 1.258 ms | 1.313 ms |
| İlk kaynak okumasıyla liste | 17.548 ms | 19.417 ms |

Tek ölçümde süreler kaynak/ağ yüküne göre değişir. İyileşme, 30 saniye sonrası filtre/sayfa geçişini uzun SQL sorgusuna bağlayan beklemeyi kaldırır. İlk okuma hâlâ ödeme view'ının SQL süresine bağlıdır; ilk açılışın hızlandığı iddia edilmez. Satırları dosya bazında toplulaştırma denemesi aktarımı azaltsa da view hesaplamasını hızlandırmadığı için finans kapsamını değiştiren bir yeniden yazım yapılmadı.

İlk okumayı ayrıca iyileştirmek için view tanımı gerekli; mevcut salt okunur hesap `sys.sql_modules.definition` alanını okuyamıyor. Dar özellik projeksiyonu ve sorguya özel row-goal iptali denemeleri güvenilir hız kazancı sağlamadığı için uygulamaya alınmadı. Veritabanı görünümü, tabloları, indeksleri veya sunucu ayarları değiştirilmedi.

Kanıtlar: [önce](payment-tracking-performance-baseline.json), [sonra](payment-tracking-performance-optimized.json).

## LOGO_DND geçişinin doğrulanması — 2 Ekim 2026

Geçişte kaynak, katalog, dosya kimliği, guard, iletişim bilgisi ve frontend sözleşmesi birlikte güncellendi. Kaynak tarihleri Asia/Famagusta gününe göre değerlendirilir; yeni Logo toplamları eski CRM kapsamıyla aynı olmak zorunda değildir. Kapsam/kimlik değişikliğinden doğan fark tahsilat olarak yorumlanmaz.

Salt okunur canlı doğrulama scripti tüm para birimlerinin tutar/ödenen/kalan/gecikmiş toplamlarını doğrudan `L_223_ODEME_PLANI` SQL sonuçlarıyla karşılaştırır; yetki ve birleşik filtreleri, listeyi, iletişim bilgisini ve geçmiş okumayı denetler. Çıktı: `output/finance-reset-2026-10-02/payment-tracking-logo-live-verification.json`. Script takip kaydı yazmaz veya mesaj göndermez.

Eski finans ürünlerinin ekran/API kaldırma onayları ayrı alındı. Logo bağlantısı ve takip modülü bu ürünlerden bağımsızdır. Veritabanı tabloları, view'lar, Prisma modelleri ve mevcut kayıtlar kaldırma kapsamına dahil değildir.

Geçiş kabul kontrolleri geçti: takip + ortak Logo bağlantısı için 7 paket / 286 test, API build, web TypeScript ve scoped lint. Canlı okumada 13.309 plan satırı / 812 dosya ve 812 fatura metadata eşleşmesi doğrulandı; dört dövizin SQL toplamları uzlaştı. İzole tarayıcı testi 51 taklit istek / 7 taklit işlemle geçti; gerçek takip kaydı veya mesaj üretilmedi. Üç masaüstü/mobil-dil menü senaryosu da geçti. API sağlığı 200, anonim takip erişimi 401, kaldırılan finans API’leri 404, `/finance` yönlendirmesi 307 olarak kontrol edildi. Toplu kanıt: `output/finance-reset-2026-10-02/completion-summary.json`.


## LOGO_DND hız iyileştirmesi — 2 Ekim 2026

Sunucu HTTP açılışını bekletmeden kaynak ön yüklemesini başlatır. Son iki dakikada kullanıcı isteği varsa son okuma tamamlandıktan 30 saniye, boşta ise 120 saniye sonra tekrar okur. Eşzamanlı kullanıcı/planlı yenilemeler tek okumayı paylaşır; zamanlayıcı kapanışta temizlenir ve kendi çalışması kullanıcı etkinliği sayılmaz. 30 saniye tazelik, 300 saniye kesin üst sınır, yerel gün değişimi ve işlem öncesi zorunlu güncel okuma korunur. Logo havuzunun boşta kalma süresi varsayılan 180 saniyedir (`LOGO_DB_IDLE_TIMEOUT_MS`); iki okuma bağlantısı yenilemeler arasında yeniden açılmaz.

Fatura ek bilgilerinin yedi alanı SQL tarafında aynı değerleri paylaşan satırlara gruplanır. Her metin alanının byte değeri ayrıca gruba dahil edildiğinden büyük/küçük harf, null, boş metin ve sondaki boşluklar birleşmez. Önce 25.001 ham satır sınırlandırılır; her grubun ham sayısı SQL int olarak döner. Toplam ham sayı 25.000'i aşarsa veya sayım geçersizse ek bilgi kaynağı kullanılamaz sayılır. Finansal ödeme planı satırlarında gruplama/tekilleştirme yapılmaz.

Tarayıcı yalnız liste cevaplarını, kullanıcı/oturum ve tam sorgu kapsamında en fazla 30 saniye RAM'de tutar; kalıcı tarayıcı depolamasına yazmaz. En fazla 12 sorgu saklanır. Listeye geri dönüşte son sonuç hemen gösterilir ve her seferinde API'den doğrulanır. Kaynak zaman sınırı ve Famagusta günü kontrol edilir; eski kaynak yeni okunmuş gibi etiketlenmez. Başarılı takip işlemi, oturum değişikliği ve açık yenileme liste önbelleğini geçersiz kılar. Foreground doğrulama hatası eski önbellek sonucuyla gizlenmez. Para/tarih formatlayıcıları yeniden kullanılır; aynı filtreyi tekrar uygulama yalnız güncel sonuçta gereksiz isteği önler.

Gerçek kaynakta servis ölçümleri (tam tarayıcı yükleme süresi değildir):

| İşlem | Önce | Sonra |
| --- | ---: | ---: |
| Tamamen boş kaynak önbelleğiyle liste | 3.600 ms | 3.124 ms |
| Logo kaynağı önceden hazırlanmış ilk liste, sorumlu cache'i boş | — | 662 ms |
| Taze kaynakta boş Yetki Kodu filtresi | 599 ms | 333 ms |
| Taze kaynakta detay | 1.329 ms | 710 ms |

Sonraki beş filtre isteği 343–377 ms, medyan 345 ms sürdü. 35 saniye sonra filtre 757 ms ölçüldü; ağ ve veritabanı gecikmesi her istekte aynı değildir. Ön yükleme soğuk SQL süresini yok etmez: sunucu açıldığı anda veya Logo bağlantı sorunu sonrası ilk istek hâlâ güncel okumayı bekleyebilir. Normal açılışta kaynak önceden hazır tutulur.

Ayrı metadata karşılaştırmasında 18.588 satır 959 gruba indi; JSON aktarım tahmini 3,17 MB'dan 179 KB'a düştü. Ters sıralı tekrar ölçümünde sorgu 2.682 ms → 1.603 ms oldu. İki karşılaştırmada da tam değer ve çokluk hash'i eşitti. Tutarlar ve müşteri kimlikleri performans kanıtına kaydedilmedi. Kanıtlar: `output/payment-tracking-speed-2026-10-02/{baseline,optimized,metadata-benchmark}.json`.

Kabul kontrolleri: backend 8 paket / 330 test, web önbelleği 9 sınır testi, API build, web TypeScript ve scoped lint geçti. Canlı 13.309 ödeme satırı / 812 dosya ve dört döviz toplamları yeniden uzlaştı. İzole tarayıcı regresyonu 67 taklit istek / 9 taklit işlemle geçti; API yanıtı bekletilirken detaydan listeye görünür dönüş 188 ms ölçüldü. Bu son değer sentetik yerel UI ölçümüdür; canlı ağ süresi değildir. Özet: `output/payment-tracking-speed-2026-10-02/summary.json`.


## Basit ödeme türü filtresi — 2 Ekim 2026

Tür, `L_223_ODEME_PLANI.PROJE KOD` alanından her ödeme satırı için belirlenir. Ek SQL sorgusu veya finansal kaynak birleştirmesi yoktur. `TRAFO`, `KDV`, `ESYA`/`EŞYA`, `DEPOZİTO ELEKTRİK`/`DEPOZITO ELEKTRIK` ayrı türlerdir. `GK-ARSA` ve numara içeren kodlar arsadır. Normal satış, bilinen `LJ`, `LJP`, `LJP2`, `LV`, `S` ön eklerinden sonra blok harfi ve daire numarası gelen konut kodlarıdır; `LJ-A15A` ve `LJP-G1-G2-G3-G4` gibi birleşik kodlar desteklenir. Boş, yeni veya belirsiz kodlar (örneğin `MO`, yalın `LJ`) **Diğer** altında kalır; otomatik konut sayılmaz. Yetki Kodu `ARAZİ` arsa sınıflandırmasında kullanılmaz.

API `paymentKind=all|sale|land|vat|transformer|furniture|deposit|other` kabul eder ve `selectedPaymentKind` döndürür. API'de parametre yoksa eski davranışı koruyan `all` kullanılır; web başlangıçta `sale` seçer ve her istekte parametreyi açıkça gönderir. Seçim URL, önbellek, sayfalama, detaydan dönüş ve yenilemede korunur. Seçili dövizde o tür yoksa boş sonuç döner. Ham kaynak, case anahtarı, kaynak satır sayısı, döviz seçenekleri ve eşleşmeyen takip kayıtları değişmez. Bir dosya birden fazla ödeme türünde bulunabileceğinden türlerin dosya sayıları birbirine eklenmez.

Yetki kodu, temsilci, broker ve fatura tarihi hâlâ dosya bazında ek bilgilerdir; bu filtrelerin seçilen ödeme satırındaki faturayı tarif ettiği iddia edilmez. Yerel takip tarihi, sorumlu, not ve öncelik de müşteri/daire/döviz dosyasının tamamında ortaktır. Detay bütün ödeme türleri ve dövizlerle açılır; liste filtresi yalnız geri dönüş için korunur. Takip işlemleri seçili döviz dosyasındaki bütün türleri kapsar. Erteleme, seçilen ödeme türü için ayrı bir takip kaydı oluşturmaz.

Doğrulama: 9 backend paketi / 377 test geçti. Karma konut/KDV/trafo, türün kendi vadesi ve parasal toplamları, eksik tutar, yalnız seçili türün ödeme durumu, dosya kimliği ve workflow kapsamı kontrol edildi. Bağımsız salt okunur canlı SQL kontrolü 13.309 satır / 812 dosyada, dört döviz için Tümü + yedi türün 32 karşılaştırmasını geçti; toplam/ödenen/pozitif kalan/gecikmiş tutarlar bütün sayfalarda uzlaştı ve tür satırlarının birleşimi tam kaynakla aynı kaldı. Script sınıflandırma oracle'ında üretim helper'ını kullanmaz. Kanıt: `output/payment-simple-filters-2026-10-02/live-kind-verification.json`; tekrar çalıştırma: `api/` altında `npx ts-node -r tsconfig-paths/register scripts/verify-payment-kinds.ts`.

Arayüz kabulü: 13 filtre/önbellek birim testi, web TypeScript ve scoped ESLint geçti. Sentetik tarayıcı testinde 84 istek / 9 işlemle tür geçişi (1.000 normal satış, 100 KDV, 50 trafo, 1.150 tümü), yanlış türde API cevabının reddi, eski Logo kayıt kodlu URL uyumluluğu, türün detaydan dönüşte korunması ve tam dosya işlem/mesaj kapsamı doğrulandı. Türkçe masaüstü ve mobil görünümler kontrol edildi; mobil alanlar tek kolon, gelişmiş filtreler kapalıdır. Eski `project` parametreli ve `paymentKind` içermeyen linklerde eski kapsamı korumak için Tümü kullanılır; kod filtresi olmayan yeni girişler Normal satış açılır. Toplu kanıt: `output/payment-simple-filters-2026-10-02/summary.json`.

## Tüm dövizlerle dosya detayı ve kapanmış dosyalar — 2 Ekim 2026

Detayda aynı müşteri kodu ve daire kodunu taşıyan kaynak dosyaları birlikte gösterilir. Eşleşme tam kod çiftiyle yapılır; müşteri adı, daire adı veya benzer kod üzerinden birleştirme yapılmaz. Müşteri/daire kimliği eksikse yalnız açılan kaynak dosyası gösterilir. Kaynak yine `LOGO_DND.dbo.L_223_ODEME_PLANI` ve aynı bellekteki kaynak sonucudur; ek finans sorgusu veya CRM kaynağı yoktur.

`PaymentTrackingDetail.portfolio` tüm dövizlerin `cases` özetlerini, `caseKey` ve `currency` ile zenginleştirilmiş `installments` satırlarını ve `fullyPaid` durumunu içerir. Eski `item` ve `installments` seçili döviz sözleşmesini korur. GBP, TL, EUR ve diğer dövizler ayrı ayrı gösterilir, birbirine toplanmaz. Detay girişinde tür/döviz/durum filtrelerinin tümü açıktır; listedeki Normal satış veya KDV seçimi detay satırlarını gizlemez. Tablo filtreleri yalnız görünümü değiştirir.

Takip anahtarları değişmez: müşteri/daire/döviz başına önceki takip kaydı, sürüm, not ve tarih korunur. Döviz kartından başka dövizin takibi açılabilir. Atama, erteleme, görüşme ve e-posta taslakları seçili döviz dosyasının bütün türleri için çalışır; diğer dövizlerin tutarları bu işlemlere katılmaz. WhatsApp ödeme hatırlatması varsayılan olarak bütün dosyanın dövizlerini ayrı bölümlerde özetler; isteğe bağlı yalnız seçili döviz kullanılabilir. Detay kardeş dosyaların takip kayıtlarını tek `getMany(keys)` okumasıyla alır; geçmiş yalnız seçili anahtara, iletişim tek müşteri koduna aittir.

`fullyPaid`, liste tür ve döviz filtrelerinden önce kaynak sonucunun tamamında hesaplanır. Aynı müşteri/daire çiftindeki her dosyanın döviz kimliği ve tutar/ödenen bilgisi biliniyor, kalan sıfır ve eksik satır sayısı sıfır olmalıdır. GBP satışı ödenmiş olsa bile TL, KDV veya başka bir kalemde borç/eksik bilgi varsa dosya tamamen kapanmış sayılmaz. Kaynakta artık bulunmayan yerel dosyalar da otomatik kapalı sayılmaz.

Liste `scope=closed` ile tamamen ödenmiş dosyaları getirir; `summary.closedCount` diğer aktif filtrelerle uyumlu, durum filtresinden önceki sayıdır. Web'de ikincil **Tamamen ödenenler** düğmesi ve açık bakiyelere dönüş bulunur. İlk açılış mevcut `actionable` görünümünü korur; `scope=all` seçildiğinde tamamen kapanan dosyalar seçilen sıralamadan bağımsız olarak en sona gelir. Önceki `scope=paid` yalnız seçili ödeme kapsamının ödenmişliğini ifade eder; tam dosya kapanmasıyla aynı değildir.

Canlı salt okunur kaynak kontrolünde 13.309 satır / 812 döviz dosyası, 801 müşteri/daire çifti bulundu. 10 çift birden çok döviz içeriyordu; 187 çift tüm ödeme türleri ve dövizlerde tamamen ödenmişti. Kendi dövizinde ödenmiş görünen 3 dosyanın başka dövizde borcu bulunduğundan bunlar tamamen kapanmış sayılmadı. Sayılar okuma anına aittir. Bağımsız SQL kontrolü: `output/payment-case-overview-2026-10-02/source-audit.json`.

Aynı kontrol, KDV içeren 70 ve trafo içeren 74 müşteri/daire çiftinin tamamının ana ödeme planındaki konut/arsa kaydıyla tam kod üzerinden bağlandığını doğruladı. Beş TL depozito dosyası farklı depozito daire kodlarıyla bağımsızdır; bunlar isim/prefix tahminiyle başka konutlara taşınmaz. `scope=closed` dört dövizde toplam 194 dosya döndürdü; müşteri/daire birleşimi 187 tam kapanmış çiftle birebir aynıydı. EUR+GBP ve GBP+TL+USD detay örneklerinde tüm kaynak satırları, türler, döviz etiketleri ve tutarlar korunuyordu.

Kabul: 10 backend paketi / 407 test, API build, 15 web birim testi, web TypeScript ve scoped ESLint geçti. İzole tarayıcı regresyonu 89 sentetik istek / 9 sentetik işlemle geçti: KDV listesinden açılan detayda tüm türler ve TL satırı, GBP/TL ayrı tutarlar, dövizler arasında takip geçişi, geri dönüş filtresi, tümü/ödenmiş ayrımı, kapalılar kısayolu, açık bakiyelere dönüş ve mobil taşma kontrol edildi. Gerçek finans kaynağına yazma veya müşteri mesajı yoktur. API sağlık kontrolü 200, anonim takip erişimi 401 döndü. Kanıtlar: `output/payment-portfolio-2026-10-02/{backend-tests,browser,web-implementation,summary}.json`.

## Ana proje filtresi — 2 Ekim 2026

Ana ekrandaki **Proje** seçimi mevcut sistem proje tanımlarını kullanır: La Joya, La Joya Perla, La Joya Perla II, Lagoon Verde ve Geçitkale 1. Etap. Daire bazındaki eski `project` alanı gelişmiş filtrelerde **Logo kayıt kodu** olarak korunur. Yeni `projectGroup` sorgu parametresi kanonik proje anahtarını veya `UNKNOWN` kabul eder; boş/eksik parametre tüm projelerdir. API `selectedProjectGroup`, `projectGroups` seçenekleri ve her listede/detayda dosyanın `projectGroup` alanını döndürür.

Sınıflandırma Logo ödeme planındaki daire kodlarına dayanır: `LJ-…`, `LJP-…`, `LJP2-…`, `LV-…` ve `GK-ARSA…` birbirinden ayrı kod aileleridir. Proje adları sistemdeki ortak tanımlardan gelir. `GK-ARSA` mevcut tek Geçitkale projesi olan `GECITKALE_1_ETAP` ile eşlenir; Logo daire açıklamasındaki Geçitkale adı tek başına etap numarasının bağımsız doğrulaması değildir. `S-…` kodlarının kaynak açıklaması Sopot'tur ve mevcut beş projeden birine atanmaz. Tanınmayan veya çelişen kodlar **Diğer / eşleşmeyen** altında kalır; müşteri adı veya serbest metin benzerliğiyle proje atanmaz.

Proje eşleştirmesi ödeme türü/döviz filtresinden önce aynı tam müşteri+daire çifti için hesaplanır. `PROJE KOD` alanı KDV, TRAFO veya ESYA olan satırlar, daire kodu ilgili projeyi belirlediğinde o projede kalır. Liste parasal toplamları, takip durumları ve sayfalama ana proje filtresini de uygular. Tam kapanma kontrolü yine bütün tür/dövizleri dikkate alır. Seçenek sayıları seçili döviz ve ödeme türünün kapsamını gösterir; henüz uygulanmamış diğer filtreleri temsil etmez.

Proje seçimi hemen uygulanır, sayfayı bire alır ve eski Logo kayıt kodu kısıtını temizler. Ödeme türü, döviz ve diğer filtreler korunur. URL, detaydan geri dönüş ve bellekteki liste önbelleği proje seçimini içerir. Detayın tüm ödeme türü/dövizleri gösterme davranışı korunur. Yeni sınıflandırma ek SQL sorgusu gerektirmez; finans kaynağı, dosya anahtarları ve takip kayıtları değişmez.

Canlı salt okunur kontrol: 13.309 ödeme satırı / 812 döviz dosyası / 801 müşteri–daire çifti korundu. La Joya 88, Perla 353, Perla II 129, Lagoon Verde 152, Geçitkale 54, Diğer 25 müşteri–daire çifti içeriyordu. Diğer grubunun 184 satırı Sopot, bağımsız depozito ve şantiye kayıtlarıdır; finans verisi dışarı atılmaz. Bilinen projelerde kod–isim veya grup içi proje çelişkisi bulunmadı. Bağımsız oracle ile dört döviz × sekiz ödeme türü × altı proje grubunun 192 kesişiminde anahtarlar, seçenek sayıları, bütün sayfalardaki parasal toplamlar ve ayrık/tam kapsam doğrulandı. Script: `api/scripts/verify-payment-projects.ts`; anonim kanıt: `output/payment-project-filter-2026-10-02/source-audit.json`.

Arayüz kabulü: 18 filtre/cache birim testi, web TypeScript ve scoped ESLint geçti. Tarayıcı testi 102 sentetik istek / 9 sentetik işlemle ana proje seçimi, Perla–Perla II ayrımı, proje+tür filtresi, eski kayıt kodunu temizleme, toplamlar, yenileme/detaydan geri dönüş, eşleşmeyen kayıtlar ve yanlış projeli API cevabının reddini doğruladı. Türkçe masaüstü ve mobil görünüm incelendi. Kanıtlar: `output/payment-project-filter-2026-10-02/{browser,web-implementation}.json`.

Backend kabulü: ödeme takip, Logo bağlantısı ve ortak proje tanımlarını kapsayan 12 paket / 456 test ile API derlemesi geçti. Prefix sınırları, belirsiz/çelişkili kodlar, generic KDV/trafo satırları, tam kapanma, döviz/tür/proje kesişimi, sayfalama ve değişmeyen dosya/aksiyon anahtarları kontrol edildi. Yerel API/web sağlık cevapları 200, anonim takip erişimi 401. Kanıt: `output/payment-project-filter-2026-10-02/backend-tests.json`.

## WhatsApp ödeme hatırlatma şablonu — 2 Ekim 2026

Dosya içindeki **WhatsApp ödeme hatırlatması** düğmesi otomatik doldurulan, düzenlenebilir bir önizleme açar. Şablon müşteri, proje/daire, kaynak değerlendirme tarihi, döviz başına toplam kalan ve vadesi geçmiş bakiye, bugün/gelecek vadeli bakiye ile geçmiş aylardaki borçları içerir. Her ayın kalan borcu, ödeme türleri ve en eski ödenmemiş asıl vadeye göre gecikme günü gösterilir. Aylarda yıl da yazılır; kısmen ödenmiş taksitlerin yalnız kalanı alınır, eşit görünen kaynak satırları tekilleştirilmez. Gün hesabı kaynak `asOf` ve asıl vade üzerinden yapılır; yerel takip ertelemesi müşterinin gerçek kaynak gecikmesini azaltmaz.

Varsayılan kapsam aynı müşteri/daire portföyünün bütün dövizleridir; tutarlar dövizler arasında toplanmaz. İstenirse yalnız seçili dövizle şablon hazırlanır. Taksit tablosundaki tür/durum/döviz filtreleri mesajı daraltmaz. Türkçe/İngilizce mesaj dili seçilebilir. E-posta taslağı önceki seçili döviz davranışını korur.

Elle düzenlenmiş metin kapsam veya dil değişimiyle kaybolmaz. Bekleyen seçimler **Şablonu yeniden oluştur** ile uygulanır; o zamana kadar üretilen metnin kapsamı gösterilir ve dış uygulama bağlantısı kapalıdır. Uygulamanın 4.000 karakter sınırını aşan metin kesilmez; kullanıcı kısaltana kadar bağlantı açılmaz. Eksik/tutarsız tutar, tarih veya döviz bilgisi olan bölüm kesin borç iddiası yerine teyit metni üretir; eksiksiz diğer döviz bölümleri korunur. Ödenmiş dosyalarda borç talebi üretilmez.

Önizleme açmak veya şablon oluşturmak API yazması yapmaz, müşteri mesajı göndermez ve görüşme kaydı oluşturmaz. **WhatsApp’ta aç** kullanıcının kontrol ettiği metni URL-encoded olarak `wa.me` bağlantısına taşır; gönderim WhatsApp içinde kullanıcı tarafından yapılır. Alıcı ülke koduyla doğrulanır, düzenlenen iletişim bilgisi kalıcı saklanmaz.

Kaynakla tutarlılık her döviz bölümünde kontrol edilir. Taksit kalanı kaynakta olduğu gibi `max(tutar - ödenen, 0)` olarak değerlendirilir; bir taksitteki fazla ödeme başka taksitteki açık borcu otomatik kapatmaz. Satırlar ile dosyanın tutar/ödenen/kalan/gecikmiş/bugün vadeli toplamları uyuşmuyorsa o bölüm teyit metnine döner.

Kabul: 59 şablon birim testi, mevcut 18 filtre/cache testi, web TypeScript ve scoped ESLint geçti. Gün sınırı, yıllara göre ay ayrımı, kısmi/fazla ödeme, eşit kaynak satırları, ertelenmiş takip, birden çok döviz, eksik/tutarsız veri, tamamen ödenmiş ve uzun metin durumları kontrol edildi. Tarayıcı regresyonu 102 sentetik istek / 9 sentetik işlemle geçti; kapsam/dil seçimi, elle düzenlenen metnin korunması, 4001 karakterin kesilmemesi, link kısıtı, Unicode/satır sonlarının bağlantıya eksiksiz taşınması ve gönderimsiz önizleme doğrulandı. Türkçe masaüstü/mobil görünüm incelendi; pencere ortalanır, şablon yenilenince metin alanı başa kayar.

Salt okunur canlı audit 13.309 satır / 812 döviz dosyası / 801 müşteri–daire portföyü üzerinden 3.226 Türkçe/İngilizce ve tüm/seçili döviz taslağını yalnız bellekte üretti. Bağımsız oracle aylık kalanları, türleri, gecikme günlerini ve döviz toplamlarını doğruladı; eksik/tutarsız taslak veya 4000 karakter aşımı yoktu. En uzun metin Türkçe 1141, İngilizce 1102 karakterdi. Script: `api/scripts/verify-payment-messages.ts`; kanıtlar `output/payment-whatsapp-template-2026-10-02/{source-template-audit,browser,web-implementation,summary}.json`.

## Genel filtreler ve tüm para birimleri — 2 Ekim 2026

Ana filtrelerdeki **Para birimi → Tüm para birimleri** seçimi, seçili ödeme türü/proje/temsilci/yetki ve diğer filtreleri bütün dövizlerde uygular. Liste müşteri–daire–döviz dosyası kimliklerini korur; aynı dairenin iki döviz dosyası listede iki satırdır. Detay yine aynı müşteri/daireye ait bütün ödeme türlerini ve dövizleri içerir. Kur dönüşümü veya dövizler arasında parasal toplama yapılmaz.

Hızlı proje, tür ve döviz değişimleri formdaki diğer taslak alanları korur. Döviz değişince yalnız açık bakiye/gecikmiş tutar aralıkları temizlenir; gecikme günü ve tarih aralıkları korunur. Boş yetki kodu varsayılanı devam eder. Belirli yetki koduyla bağdaşmayan boş/eşleşmeyen durum seçimi formda birlikte bırakılmaz.

Salt okunur canlı doğrulama tek ödeme kaynağı okumasını tekrar kullanarak 13.309 kaynak satırı / 812 döviz dosyası / 801 müşteri–daire çiftinde geçti. 158 filtre kesişiminde tüm döviz sonucu, ayrı döviz sonuçlarının tam birleşimine eşitti; 27 sayfalı senaryoda anahtarlar ve toplamlar korundu. 16 tutar sıralama birleşimi, dört para aralığı reddi ve gün aralıkları doğrulandı. Script: `api/scripts/verify-payment-all-currencies.ts`; anonim kanıt: `output/payment-all-currencies-2026-10-02/source-audit.json`. Yeni kapsam ek SQL sorgusu gerektirmez.

Backend kabulü: 13 paket / 486 test, API derlemesi ve değişen dosyaların ESLint kontrolü geçti. Yeni 30 test; boş/belirsiz döviz, döviz başına null/sıfır ayrımı, değişmeyen dosya anahtarları ve parasal kapsam, tutar aralığını kaynak okumadan reddetme, birleşik filtreler, sayfalama ve kapalı dosya sırası kontrollerini kapsar. Kanıt: `output/payment-all-currencies-2026-10-02/backend-tests.json`.

Arayüz kabulü: 29 filtre/döviz/önbellek birim testi, TypeScript ve hedefli ESLint geçti. Tarayıcı regresyonu 116 taklit istek / 9 taklit işlemle dört bilinen döviz ve belirsiz dövizi, ayrı parasal toplamları, sayfalamayı, gün/tarih korumayı, taslak filtreleri, detaydan geri dönüşü, hatalı karma döviz toplamının reddini ve kaynak kesintisinden çıkışı doğruladı. Türkçe masaüstü/mobil filtreler ve ayrı döviz kartları görsel olarak kontrol edildi. Web 200, anonim ödeme takip API erişimi 401. Kanıt: `output/payment-all-currencies-2026-10-02/{browser,web-implementation,summary}.json`.

## Sade liste görünümü — 2 Ekim 2026

Üstteki büyük giriş metni, yinelenen başlıklar, müşteri kodu satırı ve veritabanı/view adlarını taşıyan teknik footer kaldırıldı. Mobilde müşteri bilgisinden sonra açık bakiye görünür; yetki kodu sütunu sona taşındı. Arama kalıcı görünür; ödeme türü, proje, temsilci, para birimi, yetki ve gelişmiş seçimler **Filtreler** içinde isteğe bağlı açılır. Ek açıklamalar **Filtre yardımı** içinde yer alır. Ana gecikmiş ödeme özeti küçük bir alanda her dövizi ayrı gösterir; ayrıntılı yönetim kartları kapalı **Yönetim özeti** içindedir. Kaynak veya veri problemi uyarıları ve son başarılı sonuç bilgisi görünür kalır. Veri sorguları, parasal hesaplama ve takip işlemleri değişmedi.

Form doğrulaması uygulamanın mevcut tarih/tutar kurallarını kullanır (`noValidate`); geçersiz tarih bulunan filtreler kapatıldıktan sonra Ara/Enter işlemi paneli yeniden açar. Gizli tarih alanının tarayıcı doğrulamasıyla odaklanamama sorunu oluşmaz.

Arayüz kabulü: 29 mevcut filtre/önbellek testi, TypeScript ve hedefli ESLint geçti. Tam tarayıcı regresyonu 117 sentetik istek / 9 sentetik işlemle geçti; son sütun/doğrulama değişiklikleri 1 sentetik istek ve 0 işlemle ayrıca doğrulandı. Panellerin kapalı başlaması, ilk dosyanın masaüstünde ilk ekranda olması, mobilde müşteri/açık bakiyenin görünmesi, aç/kapat sırasında taslak ve filtre koruma, gizli geçersiz tarihin istek göndermeden paneli açması test edildi. Kanıt: `output/payment-simple-interface-2026-10-02/{browser,interface-smoke,summary}.json`.

## Tahsilat Raporu — 2 Ekim 2026

**Finans → Tahsilat Raporu** (`/finance/collection-report`) yönetimin vadeleri aylara göre takip etmesi içindir. Ödeme Takip başlığındaki **Rapor** kısayolu da aynı sayfayı açar. `GET /payment-collection-report`, mevcut ödeme kaynağı önbelleğini paylaşır; ay veya döviz başına yeni SQL sorgusu çalıştırmaz. Kaynak `LOGO_DND.dbo.L_223_ODEME_PLANI`, yetki/temsilci bilgisi `L_223_FATURA_VADE` üzerindendir. Rapor salt okunurdur; yerel takip kayıtlarını okumaya veya değiştirmeye ihtiyaç duymaz. ADMIN/ACCOUNTING erişimi ve önizleme kısıtları mevcut takip ekranıyla aynıdır; cevap `Cache-Control: private, no-store` taşır.

Takvim **asıl VADE** alanını kullanır (`basis=original`); takip ertelemeleri mali vadeyi değiştirmez. Varsayılan 12 aylık pencere kaynak değerlendirme ayından başlar; 6/12/24 ay seçilebilir. **Gelecek ay potansiyel tahsilat**, kaynak `asOf` tarihini izleyen takvim ayındaki taksitlerin kalanıdır; raporun dönem başlangıcını değiştirmek bu ayı değiştirmez. Kalan her satırda `max(TUTAR − ODENEN, 0)` olarak hesaplanır. Fazla ödeme başka satırların borcunu kapatmaz. Aylık tabloda planlanan, bugüne kadar ödenmiş, kalan ve gecikmiş tutarlar ayrı gösterilir; bir dosyanın tüm yıllara ait bakiyesi her aya tekrar yazılmaz.

**Ödenmiş (bugüne kadar)**, ilgili vade satırlarına bugüne kadar işlenmiş ödeme toplamıdır. Kaynakta ödeme işlem tarihi olmadığından bu sütun o ay şirkete giren nakit veya geçmiş ay sonu bakiyesi değildir. Potansiyel de tahsilat olasılığı modeli değil, planlanan kalan borçtur. Her para birimi ayrı hesaplanır; kur çevrimi ve karma döviz genel toplamı yoktur. Bilinmeyen tutarlar sıfıra çevrilmez; eksik satırlar görünür uyarı üretir. Vadesiz satırlar aylara atanmaz. Tüm yıllardaki toplam kalan, dönem öncesi/sonrası ve vadesiz kalanlar isteğe bağlı hesaplama açıklamasında ayrıştırılır.

Yeni girişte **Normal satış** ve **Yetki kodu boş** seçilidir. Döviz ve dönem başlangıcı doğrudan görünür; proje, satış temsilcisi, ödeme türü, yetki durumu ve dönem uzunluğu kapalı **Filtreler** alanındadır. Seçimler URL'de korunur. Aylık satıra veya **Dosyaları göster** düğmesine basmak o aya ait müşteri/daire/döviz dosyalarını sayfalı getirir; müşteri bağlantısı mevcut tam ödeme dosyasını açar. Ay/sayfa değişimleri toplamları değiştirmez. Başarısız filtre isteğinde son başarılı kapsam açıkça belirtilir; ay/sayfa işlemleri bu görünen kapsamdan çalışır. 401/403 ve oturum değişiminde mali veri kaldırılır; 300 saniyeyi veya kaynak gününü aşan sonuç gösterilmez.

Doğrulama: 14 backend paketi / 533 test ve API derlemesi; 36 web testi, TypeScript ve hedefli ESLint geçti. Bağımsız salt okunur canlı kontrol 13.309 kaynak satırında 127 filtre/pencere senaryosu, 248 tek döviz karşılaştırması, 7.278 aylık detay satırı ve 27 sayfalama senaryosunu doğruladı. İlgili ay, tüm yıllar, dönem dışı ve vadesiz satırların bölünmesi uzlaştı. Script `api/scripts/verify-collection-report.ts`; kimlik veya gerçek tutar içermeyen kanıtlar `output/collection-report-2026-10-02/{source-audit,backend-tests,web-implementation,browser,summary}.json` altındadır. Tarayıcı kabulü yalnız sentetik verilerle çalışır; mali veri yazmaz veya mesaj göndermez.

### Geçmiş ayların görünmesi

Rapor artık ilk açılışta ayrı, açık **Geçmiş aylar** tablosunu gösterir. Seçili filtrelere uyan, kaynak değerlendirme ayından önceki bütün vade ayları en yakından eskiye sıralanır; tamamen ödenmiş aylar da yer alır. Kayıt bulunmayan aylar eklenmez. Bu liste dönem başlangıcından ve 6/12/24 ay seçiminden bağımsızdır; eski yıl vadelerine ulaşmak için başlangıç tarihini değiştirmek gerekmez. Ay bağlantısı, mevcut detay tablosunda o aya ait dosyaları açar. Proje, temsilci, tür, yetki ve döviz seçimleri hem geçmiş hem seçili dönem tablosuna uygulanır.

API `historicalPeriods` alanında artan sıralı ayları, her dövizde `historical` alanında aynı eksene hizalı toplamları döndürür. Çoklu dövizde başka dövizden gelen aya ait kayıt yoksa ilgili döviz sıfır tutarlı satır taşır. Geçmiş aylar mevcut ödeme satırlarının ikinci görünümüdür; özet ve dönem toplamlarına yeniden eklenmez. Tarihsiz kayıtlar aylara atanmaz. Cari ayda günü geçmiş vadeler mevcut aylık planda ve gecikmiş tutarda kalır. Aylık gruplama bellekte yapılır, ek kaynak sorgusu yoktur.

Bu ekleme 14 backend paketi / 538 test, API build, 39 web testi, TypeScript ve hedefli lint ile doğrulandı. Tarayıcıda 24 sentetik istek / 0 yazma ile geçmiş ve tamamen ödenmiş ayların ilk açılışta görünmesi, geçmiş ay detayı, dönem seçimine bağımsızlık, döviz hizalama ve proje filtresi geçti. Türkçe masaüstü görünümü ve mobil taşma kontrol edildi. Kanıt: `output/collection-report-history-2026-10-02/{backend-tests,browser,summary}.json`.

### Tahsilat grafikleri

Özet kartlarının altında dört grafik bulunur: seçili dönemin aylık planlanan/bugüne kadar ödenen/kalan tutarları, geçmiş vade aylarındaki bugünkü kalan borçlar, toplam kalanın vadesi geçmiş/güncel ve gelecek/vadesiz dağılımı, seçili dönem boyunca birikimli kalan vade planı. Birikimli grafik yalnız seçili dönemin mevcut kalanlarını toplar; dönem dışındaki geçmiş borcu eklemez ve gerçekleşmiş nakit akışını tahmin etmez. Geçmiş ay grafiği de geçmiş tarihteki bakiye değil, o vade ayından bugün kalan borçtur.

Grafikler aynı onaylanmış rapor yanıtından hesaplanır; ek API/SQL okuması veya finansal yazma yoktur. Tüm para birimlerinde yerel **Grafik para birimi** seçimi tek dövizin grafiklerini gösterir; farklı dövizler toplanmaz. Ay sütunları ve klavye için ay seçici/dosya düğmesi mevcut aylık dosya detayına gider. Detay listesi raporun genel filtrelerini kullanır. Ayrıntılı vade tabloları grafiklerin altında korunur.

Ödenen ve kalan serileri yan yana çizilir; fazla ödemeyi borçtan düşüren veya planlanan tutarın yüzdesi gibi sunan bir yığma yapılmaz. Eksik veya bilinmeyen ay tutarları sıfıra dönüşmez. İlk eksik aydan sonraki birikimli toplam gösterilmez; güvenilir dağılım hesaplanamıyorsa halka grafik yerine açıklama çıkar. Sıfır borç, yüzde yüz tahsilat iddiasına dönüşmez. Grafik kodu ayrı yüklenir; grafik dövizi değişimi yeni kaynak sorgusu yapmaz. Açık/koyu tema, mobil düzen ve animasyonsuz çizim desteklenir.

Grafik kabulü: 17 model/rapor testi, TypeScript ve değişen dosyaların ESLint kontrolü geçti. Tarayıcıda 28 sentetik GET / 0 yazma ile gerçek sütun tıklaması, klavyeyle tamamen ödenmiş aya erişim, döviz seçiminin ek istek göndermemesi, eksik/boş grafikler, yetki değişiminde grafiklerin kaldırılması ve mobil taşma doğrulandı. Türkçe açık/koyu masaüstü ile dört ayrı mobil grafik incelendi. Kanıt: `output/collection-report-charts-2026-10-02/{web-charts-implementation,browser,summary}.json`.

### Yönetim için sade görünüm

Ana ekran gelecek aylarda vadesine göre beklenen tahsilata odaklanır. Yeni girişte API ve web, kaynak değerlendirme tarihini izleyen aydan başlayan **6 ayı** açar; açıkça seçilen başlangıç ayı ve 6/12/24 ay seçenekleri korunur. Normal satış ve boş yetki kodu varsayılanları değişmez; aktif kapsam görünür kalır. Para birimi doğrudan seçilir; tarih, proje, temsilci ve diğer ayarlar kapalı **Filtreler** alanındadır. **Sıfırla**, seçili dövizi koruyarak gelecek aydan başlayan varsayılan 6 aya döner.

Özet her dövizde üç bilgi gösterir: gelecek ay beklenen, seçili dönemde beklenen ve bugünkü vadesi geçmiş alacak. Dönem toplamı yalnız `monthly[].outstanding` değerlerini toplar; genel bakiye, dönem dışı borç veya gecikmiş alacak ayrıca eklenmez. Herhangi bir ilgili ay eksik/bilinmeyen tutar taşıyorsa kesin toplam yerine `—` gösterilir. Geçmiş/cari ayla başlayan açık bir aralık seçildiğinde başlıklar **seçili dönem kalan borcu** olarak değişir; bu tutarlar gelecek tahsilat gibi sunulmaz. Beklenen tahsilat vade planındaki kalandır, kesin nakit girişi veya olasılık tahmini değildir.

Dört grafik yerine tek kalan tutar grafiği ve yanında ay/tam tutar listesi vardır. Ödenmiş/planlanan serileri, halka ve birikimli grafikler, tüm yılların toplamı, dosya/taksit sayacı ve tekrarlı açıklamalar ana ekrandan kaldırılmıştır. **Geçmiş aylar** ve **Ayın dosyaları** başlangıçta kapalıdır; grafik veya ay düğmesiyle başarılı bir detay isteği sonrası ilgili dosyalar otomatik açılır. Tamamen ödenmiş geçmiş aylar korunur. Kaynak hatası, güncellik ve eksik veri uyarıları gizlenmez. Sağlıklı kaynak zamanı başlıkta kısa gösterilir.

Varsayılan sorgu değişikliği 56 API rapor testi ve API derlemesiyle, arayüz modeli 16 testle doğrulandı. Web TypeScript ve hedefli lint geçti. Tarayıcı kabulü gelecek 6 ayı, geçmiş borcun ayrı tutulmasını, açılır ayrıntıları, eski dönem etiketlerini, sıfırlamayı, grafik/ay tıklamasını, döviz ve oturum korumalarını kapsar. Kanıtlar: `output/collection-report-executive-2026-10-02/{backend-tests,web-charts-implementation,browser,summary}.json`.

## View incelemesi sonrası mali kontroller — 3 Ekim 2026

Ödeme Takip ve Tahsilat Raporu, `LOGO_DND.dbo.L_223_ODEME_PLANI` kaynağını ve yetki/temsilci için `L_223_FATURA_VADE` eşlemesini kullanmaya devam eder. `VADE`, Logo'da şu anda kayıtlı vadedir; değiştirilemez bir ilk sözleşme tarihi değildir. `PAID/ODENEN` ödeme ve kapama dağılımını içerir; ilgili vade ayında bankaya giren nakdi göstermez. API'nin mevcut `basis: original` anahtarı geriye uyumluluk için korunmuştur; yerel takip ertelemesinin dışarıda bırakıldığını ifade eder.

Kaynak yenilemesinde view'ın dayandığı PAYTRANS/INVOICE/STLINE ilişkileri ayrıca denetlenir: satır çoğalması, iptal edilmiş kayıt, yanlış fatura veya cari bağlantısı, beklenmeyen işaret, eksik kimlik/tutar ve belirsiz döviz kontrol edilir. Başarısız mali denetim `PAYMENT_TRACKING_SOURCE_AUDIT_INVALID` döndürür, sunucu önbelleğini ve ekrandaki eski tutarları kaldırır. Geçici bağlantı hatasında yalnız daha önce doğrulanmış, 300 saniyeyi ve aynı Famagusta gününü aşmamış ödeme kaynağı kullanılabilir. Arayüz, denetimsiz eski API yanıtlarını ve denetim süresi dolmuş bellek önbelleğini de reddeder.

View'ın KDV'de son kayıt seçme kuralı değiştirilmemiştir. Önceki pozitif KDV bakiyeleri iade/müşteri değişimi bulgularıyla ilgili takip dosyalarına `sourceReview` olarak bağlanır. Açılır **KDV iade / devir kontrolü** alanı bunları muhasebe incelemesi için gösterir; borç toplamlarına ve WhatsApp taslağına eklemez. `audit.excludedVatRows` bütün atlanan KDV kayıtlarının değil, incelemeye konu pozitif kalan kayıtlarının sayısıdır. Canlı kontrolde 2 böyle kayıt, iade/devir bağlantıları nedeniyle 3 takip dosyasında inceleme işareti oluşturdu.

Tahsilat Raporu'na **Bu ay kalan vade** eklendi: kaynak değerlendirme günü dahil, ay sonuna kadar vadesi bulunan taksitlerin bugünkü kalanı. Seçilen rapor döneminden bağımsızdır ve gecikmiş borcu içermez. Kapalı **Tahsilat öncelikleri** bölümü, gecikmiş alacağın en büyük 20 müşteri hesabında yoğunlaşmasını ve proje bazında gecikmiş/gelecek ay kalanlarını gösterir. Her hesap tam cari koduyla, her döviz ayrı gruplanır. Eksik veri kesin bir yüzdeye çevrilmez; yüzde payları yalnız eksiksiz paydalarla hesaplanır. Bu metrikler aynı ödeme kaynağını kullanır, yeni SQL okuması yapmaz.

## Excel sonrası tahsilat analizi — 3 Ekim 2026

Tahsilat Raporu'nun sade gelecek altı ay görünümü korunur. Aylık grafikte **Kalan vade** ve **Plan ve kapanma** seçenekleri vardır; ikinci görünüm planlanan, bugüne kadar ödenen/kapanan ve kalan tutarları yan yana gösterir. Grafik dönemi seçili aralık veya son 12 geçmiş vade ayı olabilir. Daha eski aylar, tamamen kapanmış aylar dahil, kapalı geçmiş aylar tablosunda kalır. Ayrıntılı aylık tablolar tamamlanma oranını da gösterir. Ödenen/kapanan, o ay bankaya giren para veya geçmiş ay sonu bakiyesi değildir.

**Projelere göre** ve **Satış temsilcilerine göre** grafiklerinde seçili dönem kalanı, gecikmiş alacak veya gelecek ay kalanı seçilir. İlk sekiz grup grafikte, bütün gruplar açılır tabloda gösterilir. Bir grup seçilince rapor o kapsama filtrelenir; ardından ay seçilerek dosyalara ulaşılır. Tüm para birimlerinde grafik dövizi yerel olarak değişir, dövizler toplanmaz ve grafik kontrolleri yeni kaynak sorgusu yapmaz.

Birden fazla temsilcili dosya **Birden fazla temsilci** grubunda yalnız bir kez sayılır; temsilcisiz dosya ayrı gruptadır. Yeni `representativeState=multiple|unassigned` filtreleri temsilci adıyla birlikte kullanılamaz. Belirli temsilci adı, önceki davranış gibi o kişinin ortak dosyalarını da kapsar. Temsilci verisi kullanılamıyorsa dağılım gösterilmez; temsilci filtresi sessizce kaldırılmaz. Proje ve temsilci grupları, ilgili dövizin dönem/gecikmiş/gelecek ay tutarlarını ve dosya sayılarını eksiksiz, çakışmasız böler.

API `analyticsVersion: 1`, döviz başına `period`, `projectBreakdown`, `representativeBreakdown` ve aylık `completionPercent` alanlarını sağlar. Tamamlanma, aylık yüzdelerin ortalaması değil, toplam ödenen/kapanan tutarın toplam planlanana oranıdır. Fazla ödeme yüzde 100'e kırpılmaz. Sıfır payda, eksik/belirsiz döviz veya güvenilir olmayan kaynak bileşeninde oran `null` kalır. Dönem dosya sayısı aylık sayıların toplamı değil, benzersiz dosya sayısıdır. Arayüz sözleşme doğrulaması yanlış toplamı, grup çoğalmasını, yanlış ay eksenini ve eski analitik sözleşmesini reddeder.

**Peşinat araştırması:** Excel'deki 12 işaretli örneğin 11'i aynı müşteri/daire, vade ve bakiye ile eşleşti; 6 işaretsiz kontrol de eşleşti. Eşleşen peşinat örneklerinin 10'u ilk vade değilken bir normal kontrol ilk vadedir. KDV dışındaki 18.501 ödeme satırında `PAYMENTTYPE`, `INSTALTYPE`, `PAIDINCASH` sıfırdır; ödeme açıklamaları boştur. Örnekleri açıklayan ödeme planı bağlantısı veya ayırıcı kod bulunamadı. Bu nedenle ilk taksiti peşinat sayan bir grafik/filtre eklenmedi. Güvenilir ayrım için sabit ödeme kaydı kimliğine bağlı doğrulanmış taksit türü veya sözleşme planı gerekir. `collection-downpayment-samples.py` ve `research-collection-downpayment.ts` salt okunur araştırmayı tekrarlar; sonuç `output/collection-analytics-2026-10-03/downpayment-research.json` içindedir.

Doğrulama: 15 backend paketi / 680 test, API üretim derlemesi, 163 web testi, TypeScript ve hedefli ESLint geçti. Tarayıcıda 35 taklit GET / 0 yazma ile grafik modları, geçmiş ve kapanmış vadeler, proje/temsilci seçimi, kapsam sıfırlama, dövizler, erişim/güncellik korumaları ve mobil görünüm doğrulandı. Salt okunur canlı kontrol, tek kaynak yenilemesindeki 5 SELECT ile 13.309 satır / 812 dosyayı aldı; 32 senaryoda 550.201 bağımsız hesap ve arayüz sözleşmesi kontrolü geçti. İlk kaynak okuması yaklaşık 3,29 saniye, önbellekten rapor yaklaşık 39 ms sürdü; yeni analitikler ek SQL üretmedi. Araç `api/scripts/verify-collection-analytics.ts`; canlı ve tarayıcı kanıtları `output/collection-analytics-2026-10-03` altındadır. Logo kayıtları veya view tanımları değiştirilmedi.

## Ödeme Takip ve Tahsilat Raporu: Fatura OK — 3 Ekim 2026

İki ekrandaki **Fatura OK** filtresi kullanıcının son tercihiyle **DND** seçili açılır. Açık URL seçimleri (Tümü dahil) korunur; filtre etiketini kaldırmak veya ödeme listesindeki Temizle işlemi Tümü kapsamını seçer. Tahsilat raporunda Sıfırla başlangıç seçimi DND'ye döner. Kaynak `LOGO_DND.dbo.L_223_FATURA_VADE.FAT_OK`, fatura başlığındaki `LG_223_01_INVOICE.SPECODE` alanıdır; bir evet/hayır veya ödeme tamamlandı göstergesi değildir. Canlı kaynakta DND, GÜL, KOZANSOY ve boş değerleri görülmüştür. Alan mevcut metadata SELECT'ine eklenir; filtre değişikliği ek Logo sorgusu gerektirmez. Eski CRM view'ları kullanılmaz.

Filtre bütün takip dosyasını (tam cari kodu + daire kodu + döviz) sınıflandırır. Tek özel kod, yalnız boş, **Karma** ve **Bilinmiyor** birbirini dışlayan gruplardır. Bir dosyada birden çok kod veya kod ile boş değer birlikteyse Karma olur; tüm tutarı bir özel koda yazılmaz. Ödeme türü seçilse bile dosyanın fatura kodu sınıflandırması korunur. Dosya detayı önceden olduğu gibi bütün ödeme türlerini ve dövizlerini gösterir.

İki API `invoiceOk=all|blank|mixed|unknown|value:<ham kod>` alır; değer ön eki gerçek kodları özel filtre durumlarından ayırır. Büyük/küçük harf ve sondaki boşluklar korunur. Yanıt `selectedInvoiceOk`, `invoiceOkOptions` ve dosya başına `invoiceOk: {status, values, hasBlank}` içerir. Seçili filtrede kaynak okunamazsa 503 döner; Tümü kapsamı finansal veriyi gösterir ve alanı bilinmiyor olarak işaretler. Tablodaki Fatura OK sütunu, URL, etkin filtre, sıfırlama ve bellek önbelleği aynı kapsamı kullanır. Tahsilatın özetleri, geçmiş/gelecek ay grafikleri, proje/temsilci kırılımları ve ayın dosyaları aynı filtrelenmiş vadelerden hesaplanır; dövizler ayrı kalır.

Canlı doğrulama `scripts/verify-payment-invoice-ok.ts` ile salt okunur yapılır. 812 dosya / 13.309 ödeme satırında 24 kapsam kontrolü, tek döviz ve bütün dövizler, yetki kodu tümü/boş, varsayılan Tümü değişmezliği ve özel kod gruplarının aylık/geçmiş toplamları eksiksiz bölmesi doğrulandı. Kimlik ve tutar içermeyen sonuç: `output/payment-invoice-ok-2026-10-03/live-verification.json`. İlgili 16 API paketinde 772 test ve API üretim TypeScript kontrolü geçti.

Arayüz doğrulaması: 287 web testi, TypeScript ve hedefli ESLint geçti. Sentetik Chrome senaryolarında ödeme listesi, filtre etiketi/sıfırlama, tahsilat kartları, proje/temsilci grafikleri ve ay ayrıntısında aynı kapsam doğrulandı. Canlı Chrome testi iki ekranda Tümü → DND → GÜL → Karma → Tümü geçişlerini 10 başarılı GET, sıfır veri yazımı, sıfır ağ/JavaScript/arayüz hatasıyla tamamladı. Varsayılan ödeme listesi 245 dosyadan DND 241, GÜL 3, Karma 1 olarak ayrılıp tekrar 245'e döndü; tahsilatın seçili ayı 197 dosyadan 191/5/1 olarak ayrılıp geri döndü. Kanıtlar aynı çıktı klasöründeki `browser-live-result.json`, `payment-browser.json` ve `collection-browser.json` dosyalarıdır.


## Tahsilat raporunun güncel yönetim görünümü — 3 Ekim 2026

Ana görünüm gelecek tahsilat ve gecikmiş alacaklara eşit ağırlık verir. Gelecek ay, tüm gecikmiş vadeler ve bugünden ay sonuna kalan vadeler üç ayrı karttır; bu kartlar örtüşebilen kapsamlar olduğundan birbirine eklenmez. Seçili dönemin kalanı aylık grafikte gösterilir. Gelecek ay ve dönem ayrıntıları tamamen kapanmış vadeleri de içerebilir. Dönem varsayılanı gelecek aydan başlayan 6 aydır; gelecek 6/12/24 ve geçmiş 12 ay kısayolları kaynak `asOf` tarihinden hesaplanır. Ödenen/kapatılan tutarlar gerçek nakit giriş raporu değildir.

Para birimi, proje, satış temsilcisi ve dönem üst filtre panelinde birlikte görünür. Diğer filtreler açılır bölümde, geçerli rapor kapsamı kaldırılabilir etiketlerde gösterilir. Taslak seçimler Uygula ile devreye girer. Grafik sütunları, birikimli noktalar ve gecikme dilimleri filtre veya dosya seçimi yapmaz; proje/temsilci tabloları da raporu daraltmaz. Sıfırla DND, normal satış ve boş yetki kodu başlangıç kapsamına döner. Tüm para birimleri seçilince üst filtre panelindeki tek döviz seçimi kartları ve bütün grafikleri birlikte yönetir. Dövizler toplanmaz. Açık dosya bağlantıları ve özet kartları gösterilen dövizde ayrıntı açabilir. Geçmiş tablosundaki her döviz satırı kendi dövizinin ayrıntısını açar.

Aylık grafikte kalan, birikimli kalan ve plan/kapanma görünümleri vardır. Eksik bir aydan sonraki birikimli tutar hesaplanmaz. Proje ve temsilci grafikleri en yüksek altı grubu gösterir; kalan grupların toplamı ve bütün gruplar açılır tabloda bulunur. Gecikme dağılımı orijinal vade tarihine göre 1–30, 31–60, 61–90 ve 90 günü aşan vadeleri ayırır. Aynı dosya birden fazla yaş grubunda bulunabileceğinden grup dosya sayıları toplam dosya sayısı olarak toplanmaz.

`GET /payment-collection-report` ek sorgu alanları:

- `detailScope=month|overdue|period|undated` (varsayılan `month`).
- `agingBucket=1_30|31_60|61_90|90_plus`; yalnız `detailScope=overdue` ile kullanılabilir, diğer kombinasyonlar 400 döner.
- `detailMonth` ay kapsamını belirler; diğer kapsamlar için eski alan yanıt uyumluluğu amacıyla korunur.

Yanıt `byCurrency[].aging`, `detail.scope` ve `detail.agingBucket` alanlarını içerir. Ayrıntı kapsamının değiştirilmesi üst özetleri veya finansal filtreleri değiştirmez. Aynı kaynak snapshot'ından bellekte hesaplanır; ek Logo sorgusu veya veri yazımı yoktur. Arayüz, yaşlandırma toplamlarını ve ayrıntı kapsamını finansal tutar göstermeden önce doğrular.

Excel/CSV dışa aktarımı geçerli raporun aylık planını, uygulanan filtreleri ve ayrı döviz satırlarını içerir; sayfalı dosya listesinin tamamıymış gibi sunulmaz. Eksik/bilinmeyen parasal değerler boş kalır. Eski, hatalı veya yüklenmekte olan rapor dışa aktarılmaz; kaynak metinlerinden elektronik tablo formülü çalıştırılması önlenir.

Doğrulama kanıtları `output/collection-report-premium-2026-10-03` altındadır. API 693 test geçti. Salt okunur canlı doğrulama 13.309 satır /812 dosyada 40 senaryo ve 721.883 kontrolü geçti; tek soğuk kaynak okuması 5 SELECT, sıcak rapor yaklaşık 47 ms. Canlı Chrome'da DND/boş yetki başlangıcı, tüm gecikmeler, 90+ gün, dönem, ay ve döviz ayrıntıları doğrulandı; veri yazılmadı. Masaüstü, mobil ve koyu tema ekran görüntüleri kontrol edildi.

Web tarafında 243 test, TypeScript ve hedefli ESLint geçti. Sentetik Chrome regresyonu 52 GET /0 yazma ile kapsam/döviz izolasyonu, klavye erişimi, CSV, kapalı geçmiş tabloları, yaş/dönem/vadesiz ayrıntıları, kaynak hataları ve mobil/koyu tema davranışını doğruladı (`browser/collection-browser.json`).

Üst paneldeki **Dosya listesi**, rapor filtrelerinden ayrı olarak ay/dönem/gecikmiş/vadesiz kapsamını ve gecikme yaşını seçtirir. **Dosyaları göster** yalnız mevcut uygulanmış rapor filtreleriyle ayrıntıyı yeniler; bekleyen finansal filtre taslağını uygulamaz ve üst özetleri değiştirmez. Grafikler fare ve klavye etkileşiminde tutarları incelemek içindir; filtreleme üst panelden yapılır. Ayrıntı tablolarındaki açık dosya düğmeleri, kaynak kontrolleri ve DND/boş yetki başlangıcı korunur.

Üst filtre düzeni 60 ilgili model/sözleşme testi, TypeScript, ESLint ve 56 sentetik GET /0 yazma ile doğrulandı. Grafik tıklamaları URL veya sorgu kapsamını değiştirmiyor; dosya formunda Enter bekleyen rapor filtrelerini uygulamıyor. Masaüstü/mobil/koyu tema ve gerçek kaynakla salt okunur açılış kontrolü geçti. Kanıt: `output/collection-top-filters-2026-10-03/browser/report.json`.


### Finans yöneticisi için okunurluk çalışması — 3 Ekim 2026

Mevcut arayüz denetiminde filtre paneli yaklaşık 310 px yer kaplıyor, ilk grafik 1440 px masaüstünde yaklaşık 875 px aşağıda başlıyordu. Seçili dönem toplamı üst kartta, aylık grafikte ve iki dağılım grafiğinde yeniden büyük rakam olarak tekrarlanıyordu. Gecikmiş toplam ve 90 gün üzeri tutarları da tekrar ediyordu. Sayfa, verinin anlamından önce kontrol seçmeyi gerektiriyordu.

Bu değerlendirme ONS'nin [dashboard önerileri](https://service-manual.ons.gov.uk/data-visualisation/guidance/dashboards), [grafik metni ilkeleri](https://service-manual.ons.gov.uk/data-visualisation/guidance/chart-text) ve NN/g'nin [kademeli ayrıntı yaklaşımı](https://www.nngroup.com/articles/progressive-disclosure/) ile desteklendi. Önemli göstergeleri önce sunmak, tekrarları azaltmak, başlık/ölçü/birim/dönemi açıklaştırmak ve daha az kullanılan seçenekleri ikincil alanda tutmak bu kaynakların ortak yönüdür. Aşağıdaki uygulama kararları bu projeye özgü tasarım çıkarımlarıdır; muhasebe standardına uygunluk iddiası değildir.

Güncel yapı: kompakt üst filtreler; gelecek ay tahsilat planı, tüm gecikmiş alacak ve bugünden ay sonuna vadeler için üç özet kartı; aylık vade grafiği ile alacak yaşlandırması; proje/temsilci alacak dağılımları; gerektiğinde açılan tablolar. Üst filtrelerin dört ana alanı korunurken iç içe kutular, başlıklar ve yinelenen ikonlar kaldırıldı. Uygulanan DND/boş yetki/normal satış kapsamı görünür kalır. Etiketler küçültülmeden gereksiz boşluk ve tekrar azaltıldı.

Seçili dönem toplamı yalnız aylık grafikte bulunur; dönem için ayrı dördüncü kart kaldırıldı. Aylık grafikte ikinci bir tarih seçicisi bulunmaz; tek tarih otoritesi üstteki rapor dönemidir. Grafik türü tek seçiciden değişir; aylık ve plan/kapanma tabloları birleşti. Türkçe tutar eksenlerinde belirsiz “B” yerine “bin”, “mn”, “mlr” kullanılır; grafik üzerinde yuvarlatılmış, bilgi kutusu ve tablolarda kesin tutarlar gösterilir. Grafik tıklamasıyla filtreleme geri eklenmedi.

**Finansal açıklık:** [IAS 7'nin nakit hareketi tanımı](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows.html/) ile mevcut veri semantiği birlikte değerlendirildi: Logo vade planında ödenen/kapanan tutar, aylık nakit girişi değildir. Arayüzde vade planı temeli açıkça belirtilir; ayrıntı “Rapor nasıl okunur?” bölümündedir. Gecikmiş kart tüm geçmiş vadeleri kapsar; aylık grafik seçili dönemi izler. Bu ay kartı yalnız bugünden ay sonuna vadeleri kapsar. Para birimleri ve örtüşebilen rapor/kart toplamları toplanmaz. Yaşlandırmadaki son grup backend'de >90 gün olduğundan “90+” yerine “90 gün üzeri” olarak adlandırılır. Dağılım grafikleri satış veya tahsilat performansı sıralaması diye sunulmaz. Eksik veri sıfıra çevrilmez.

Kaynak/API hesaplamaları değiştirilmedi. Bu çalışma görsel hiyerarşi, dil, kontrol sayısı ve görünüm düzenlemesidir. Yedekler ve tarayıcı kanıtları `output/collection-clarity-2026-10-03` altındadır.

İlk canlı masaüstü ölçümünde üst panel yüksekliği 181,6 px, aylık grafik başlangıcı 632,6 px oldu (önceki yaklaşık 310/875 px). 64 ilgili model/sözleşme/dışa aktarım testi, TypeScript ve hedefli ESLint geçti. Gerçek Logo kaynağı ile yalnız okuma açılışı; DND, döviz ayrımı ve grafik görünümü kontrol edildi.

Son Chrome regresyonu 57 sentetik GET / 0 yazma ile geçti. Üç kart, tek dönem kontrolü, birleşik aylık tablo, kapalı yardım, grafiklerin filtre uygulamaması, taslak/kapsam/döviz ayrımı, CSV, güncellik/erişim kontrolleri ve mobil/koyu tema doğrulandı. 1440 px test görünümünde filtre paneli 182 px, kart bloğu 135 px, ilk grafik başlangıcı 634 px ölçüldü. Sonuç: `output/collection-clarity-2026-10-03/browser/report.json`.
