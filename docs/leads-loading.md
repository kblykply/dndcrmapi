# Lead listesi yükleme iyileştirmesi

29 Eylül 2026 — yerel CRM değişiklikleri; production dağıtımı yapılmadı.

## Değişiklikler

- Normal lead ekranı zaten ilk istekte 25 kayıt getiriyordu. Backend en fazla 100 kayıt döndürüyordu; tüm leadler aynı anda indirilmiyordu.
- Liste sorgusundaki kullanılmayan `ownerCallCenter`, `assignedManager` ve `assignedSales` ilişkileri kaldırıldı. Lead'in kendi alanları ve detay endpointindeki ilişkiler korundu. `/leads`, `/admin/leads` ve `/manager/queue` bu iç içe nesneleri kullanmıyor.
- Eşit sıralama değerlerinde sayfaların daha kararlı olması için son sıralama alanı `id` oldu.
- `GET /leads` varsayılan olarak toplam sayıyı döndürmeye devam ediyor. İsteğe bağlı `includeTotal=false` yalnızca `items`, `page`, `pageSize` döndürür; `total` ve `totalPages` bulunmaz. Parametrenin kabul edilen değerleri `true` ve `false`.
- Normal lead ekranı, toplam sayıyı aynı kullanıcı/rol/filtre için en fazla 30 saniye tutar. Yalnız sayfa geçişleri bu değeri kullanır; filtreleme ve kayıt işlemleri yeni toplam ister. Boşalan son sayfa ilk sayfaya dönerek toplamı yeniler. Başka kullanıcıların yaptığı değişiklikler nedeniyle toplam bu süre boyunca eski kalabilir.
- Eski liste istekleri iptal edilir ve geç gelen cevaplar yeni sonucu değiştiremez. İlk yüklemede boş liste mesajı yerine yüklenme durumu gösterilir.
- Admin lead ekranında 25/50/100 kayıtlık sunucu sayfalaması, sunucuda arama ve durum filtresi kullanılır. Önceden 1000 kayıt istenmesine rağmen API sınırı nedeniyle yalnız ilk 100 kayıt içinde filtreleme yapılıyordu. Toplu seçim mevcut sayfayla sınırlıdır; silme sonrası toplam ve son sayfa düzeltilir.
- Bildirimler ilk WebSocket bağlantısında aynı HTTP isteklerini tekrar göndermez. İlk HTTP yüklemesi, yeniden bağlantı ve periyodik yenileme korunur.
- Yerel `api/.env`: `PG_POOL_MIN=1`, `PG_IDLE_TIMEOUT_MS=60000`; `PG_POOL_MAX=2` korundu. Bir bağlantının kısa boşluklarda kapanmasını önler. Production ortam değişkenleri değiştirilmedi.

Manager kuyruğunun mevcut ilk 100 kayıt sınırı bu çalışmada değiştirilmedi.

## Ölçüm

Kaynak: `leads-loading-performance-2026-09-29.json`.

Yerel süreçten yapılandırılmış uzak veritabanına, aynı filtreyle aynı 25 kayıt üzerinde ölçüldü. Bir ısınma turundan sonra her yol iki kez çalıştırıldı; kayıt kimliklerinin aynı olduğu doğrulandı. Liste ölçümleri tek bir salt okunur transaction içinde yapıldı. Bunlar HTTP isteği veya ekranın tamamen açılma süresi değildir; kimlik doğrulama, ilk bağlantı, tarayıcı çizimi ve geliştirme derlemesi sürelerini içermez.

| Sorgu yolu | Ortalama | SQL sorgusu |
| --- | ---: | ---: |
| Önce: ilişkiler + liste + toplam | 1.797 ms | 5 |
| Sonra: liste + toplam | 917 ms | 2 |
| Sonra: toplamı önbellekten kullanan sayfa | 418 ms | 1 |

Liste ve toplam yolu bu küçük örneklemde yaklaşık %49, toplam sorgulamayan yol yaklaşık %77 daha kısa sürdü. Ağ koşullarına göre sonuçlar değişebilir. Ölçülen JSON veri boyutu yaklaşık 19,8 KB'den 16,0 KB'ye indi; bu ağdaki sıkıştırılmış boyut değildir.

Ayrı `SELECT 1` denemesinde, 6,1 saniye boşta kaldıktan sonraki istek eski havuz ayarında 2.065 ms, yeni ayarda 285 ms sürdü. Eski ayar ikinci bağlantıyı açarken yeni ayar ilk bağlantıyı tekrar kullandı. Her havuz ayarı için tek boşta kalma denemesi yapıldı.

## Doğrulama

- Backend: `leads.list.spec.ts`, `leads.work-retention.spec.ts`, `pool-options.spec.ts` — 3 test grubu, 17 test geçti.
- Backend uygulama TypeScript kontrolü (`tsconfig.build.json`) geçti.
- Web TypeScript kontrolü geçti.
- `web/tests/leads-loading.browser.cjs`: ilk yükleme, sayfalama, eski cevaplar, toplam önbelleği süresi ve yenilenmesi, boşalan son sayfa geçti.
- `web/tests/admin-leads-pagination.browser.cjs`: 25/50/100, sunucuda filtreleme, ilk 100 dışındaki sonuçlar, yetki, sayfa seçimi, silme sonrası sayfa düzeltme, hata sonrası yenileme ve mobil görünüm geçti.
- `web/tests/notifications-loading.browser.cjs`: ilk yükleme, bağlantı/yeniden bağlantı, periyodik yenileme, WebSocket yokluğu ve olaylar geçti.
- Tarayıcı testlerinde iş verisi istekleri taklit edildi; gerçek lead oluşturulmadı veya silinmedi.
- API `/health` sağlıklı; yerel `/leads` HTTP 200 döndürüyor.

Tüm test dosyalarını içeren backend TypeScript kontrolünde, bu çalışma dışındaki `digital-team.http.spec.ts` ve `logo-report.service.spec.ts` dosyalarında önceden var olan tip hataları devam ediyor. Main lead ve bildirim dosyalarının mevcut `no-explicit-any` uyarıları da bu çalışmada kapsam dışı bırakıldı.

Tekrarlanabilir salt okunur ölçüm: `api/` altında `node scripts/diagnose-leads-performance.cjs`. Kimlik bilgileri veya lead içerikleri yazdırılmaz; çıktı `/private/tmp/crm-leads-optimization-performance.json` olur.
