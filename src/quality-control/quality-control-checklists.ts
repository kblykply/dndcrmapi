export type DefaultQualityChecklistItem = {
  key: string;
  title: string;
  description: string;
  required: boolean;
};

const checklist = (
  ...rows: Array<
    readonly [
      key: string,
      title: string,
      description: string,
      required?: boolean,
    ]
  >
): DefaultQualityChecklistItem[] =>
  rows.map(([key, title, description, required = true]) => ({
    key,
    title,
    description,
    required,
  }));

export const DEFAULT_QUALITY_CHECKLISTS: Record<
  string,
  DefaultQualityChecklistItem[]
> = {
  '4.1': checklist(
    [
      'internal-context',
      'İç bağlam güncel olarak değerlendirildi',
      'Organizasyon yapısı, yetkinlikler, kaynaklar, kültür, performans ve iç süreçlerdeki güçlü veya zayıf yönler kayıt altına alındı.',
    ],
    [
      'external-context',
      'Dış bağlam ve piyasa koşulları değerlendirildi',
      'Ekonomik, teknolojik, hukuki, sosyal, rekabetçi ve Kuzey Kıbrıs gayrimenkul pazarına özgü gelişmeler incelendi.',
    ],
    [
      'strategic-direction',
      'Bağlam ile stratejik yön arasındaki ilişki doğrulandı',
      'Tespit edilen konuların şirket hedefleri, proje portföyü ve kalite yönetim sistemi sonuçlarına etkisi açıklandı.',
    ],
    [
      'context-register',
      'Bağlam analiz kaydı güncellendi',
      'SWOT, PESTLE, toplantı tutanağı veya eşdeğer kayıt; tarih, sorumlu ve değerlendirme sonucu ile saklandı.',
    ],
    [
      'material-changes',
      'Önemli değişikliklerin etkisi ele alındı',
      'Yeni proje, mevzuat, kur, tedarik, personel veya müşteri beklentisi değişiklikleri için gerekli aksiyonlar belirlendi.',
    ],
    [
      'review-cycle',
      'Periyodik bağlam gözden geçirmesi tamamlandı',
      'Gözden geçirme sıklığına uyuldu; kararlar, sorumlular ve terminler yönetim değerlendirmesine aktarıldı.',
    ],
  ),
  '4.2': checklist(
    [
      'party-register',
      'İlgili taraf listesi güncellendi',
      'Müşteriler, çalışanlar, hissedarlar, acenteler, tedarikçiler, taşeronlar, bankalar ve resmi kurumlar tanımlandı.',
    ],
    [
      'relevant-needs',
      'İlgili ihtiyaç ve beklentiler belirlendi',
      'Her tarafın kalite sistemiyle ilgili şartları, önceliği ve karşılanmaması halinde oluşacak etkiler kaydedildi.',
    ],
    [
      'customer-expectations',
      'Müşteri beklentileri doğrulandı',
      'Satış bilgisi, sözleşme, teslim tarihi, ürün kalitesi, tapu, iletişim ve satış sonrası hizmet beklentileri ele alındı.',
    ],
    [
      'legal-authorities',
      'Resmi kurum ve mevzuat şartları doğrulandı',
      'İzin, ruhsat, yapı kontrolü, vergi, tapu ve ilgili yasal yükümlülüklerin güncel şartları kaydedildi.',
    ],
    [
      'supplier-needs',
      'Tedarikçi ve taşeron şartları değerlendirildi',
      'Teknik şart, teslim süresi, ödeme, yeterlilik, iş güvenliği ve kalite kayıtlarına ilişkin karşılıklı beklentiler belirlendi.',
    ],
    [
      'party-monitoring',
      'İlgili taraf değişiklikleri izlendi',
      'Yeni veya değişen şartlar için sorumlu, aksiyon ve gözden geçirme tarihi atanarak kanıtı saklandı.',
    ],
  ),
  '4.3': checklist(
    [
      'scope-statement',
      'KYS kapsam beyanı açıkça tanımlandı',
      'Kalite yönetim sisteminin sınırları, amacı ve uygulandığı faaliyetler anlaşılır bir kapsam metninde yer alıyor.',
    ],
    [
      'locations-functions',
      'Kapsamdaki lokasyon ve fonksiyonlar listelendi',
      'Merkez ofis, şantiye, satış, müşteri ilişkileri, teslim ve satış sonrası operasyonlarının kapsam durumu belirtildi.',
    ],
    [
      'products-services',
      'Kapsamdaki ürün ve hizmetler belirtildi',
      'Gayrimenkul geliştirme, inşaat üretimi, satış, teslim ve satış sonrası hizmetlerin sınırları tanımlandı.',
    ],
    [
      'applicability',
      'Standart maddelerinin uygulanabilirliği değerlendirildi',
      'Uygulanmayan bir şart varsa ürün-hizmet uygunluğunu etkilemediği kanıtlanarak gerekçesi yazılı hale getirildi.',
    ],
    [
      'context-alignment',
      'Kapsam bağlam ve ilgili taraflarla uyumlu',
      '4.1 ve 4.2 analizlerindeki önemli konuların kapsam kararına nasıl yansıdığı doğrulandı.',
    ],
    [
      'scope-approval',
      'Kapsam onaylandı ve erişilebilir durumda',
      'Güncel kapsam yetkili yönetici tarafından onaylandı, revizyonu tanımlandı ve ilgili çalışanlara erişim sağlandı.',
    ],
  ),
  '4.4': checklist(
    [
      'process-inventory',
      'KYS süreç envanteri tamamlandı',
      'Yönetim, destek, inşaat, satış, teslim ve satış sonrası süreçler ile süreç sahipleri tanımlandı.',
    ],
    [
      'inputs-outputs',
      'Süreç girdileri ve çıktıları belirlendi',
      'Her süreç için gerekli bilgi, kaynak, talep ve beklenen ürün, hizmet, karar veya kayıt açıklandı.',
    ],
    [
      'sequence-interactions',
      'Süreç sırası ve etkileşimleri doğrulandı',
      'Süreçler arası devir noktaları, sorumluluklar ve bilgi akışı süreç haritasında gösterildi.',
    ],
    [
      'criteria-kpi',
      'Kontrol kriterleri ve performans göstergeleri belirlendi',
      'Süreç etkinliğini izlemek için yöntem, kabul kriteri, hedef, veri kaynağı ve ölçüm sıklığı tanımlandı.',
    ],
    [
      'resources-owners',
      'Kaynaklar ve süreç sorumluları atandı',
      'İnsan, altyapı, teknoloji, bütçe ve karar yetkisi gereksinimleri süreç bazında doğrulandı.',
    ],
    [
      'risks-records-improvement',
      'Risk, kayıt ve iyileştirme kontrolleri işletiliyor',
      'Süreç riskleri ele alındı; gerekli dokümante bilgiler saklandı ve performans sapmaları için iyileştirme başlatıldı.',
    ],
  ),
  '5': checklist(
    [
      'management-accountability',
      'Üst yönetim KYS etkinliği için hesap verebilirliğini gösterdi',
      'Yönetim kararları, toplantı kayıtları ve atanmış aksiyonlar kalite sistemine aktif katılımı kanıtlıyor.',
    ],
    [
      'business-integration',
      'KYS şartları iş süreçlerine entegre edildi',
      'Kalite kontrolleri proje, inşaat, satış, teslim ve satış sonrası günlük iş akışlarının bir parçası olarak uygulanıyor.',
    ],
    [
      'customer-focus',
      'Müşteri odaklılık ve uygunluk riskleri yönetiliyor',
      'Müşteri ve yasal şartlar belirleniyor; memnuniyeti etkileyen risk ve fırsatlar yönetim tarafından izleniyor.',
    ],
    [
      'quality-policy',
      'Kalite politikası güncel ve uygulanabilir',
      'Politika şirket amacı ve bağlamıyla uyumlu, hedeflere çerçeve sağlıyor ve iyileştirme taahhüdünü içeriyor.',
    ],
    [
      'roles-authorities',
      'Rol, sorumluluk ve yetkiler açıkça atandı',
      'Süreç sahipleri; raporlama, uygunluğu güvence altına alma ve müşteri odağını sürdürme yetkilerini biliyor.',
    ],
    [
      'resources-support',
      'Yönetim gerekli kaynak ve desteği sağladı',
      'Kritik kalite faaliyetleri için personel, zaman, bütçe, ekipman ve eğitim ihtiyaçlarının karşılandığı doğrulandı.',
    ],
    [
      'leadership-review',
      'Kalite performansı yönetim tarafından gözden geçirildi',
      'Hedefler, müşteri geri bildirimi, uygunsuzluklar ve kaynak ihtiyaçları değerlendirilerek karar ve aksiyon oluşturuldu.',
    ],
  ),
  '6': checklist(
    [
      'planning-inputs',
      'Planlama girdileri doğrulandı',
      'Bağlam, ilgili taraf şartları, süreç performansı ve stratejik hedefler planlamaya girdi olarak kullanıldı.',
    ],
    [
      'risk-actions',
      'Risk ve fırsat aksiyonları planlandı',
      'Önem derecesine uygun kontroller, sorumlular, kaynaklar ve tamamlanma tarihleri belirlendi.',
    ],
    [
      'quality-objectives',
      'Ölçülebilir kalite hedefleri oluşturuldu',
      'Hedefler politika ile uyumlu; gösterge, başlangıç değeri, hedef değer ve dönem içeriyor.',
    ],
    [
      'objective-delivery-plan',
      'Hedef gerçekleştirme planları hazırlandı',
      'Ne yapılacağı, kim tarafından, hangi kaynakla, ne zaman ve nasıl değerlendirileceği tanımlandı.',
    ],
    [
      'change-planning',
      'KYS değişiklikleri kontrollü olarak planlandı',
      'Değişikliğin amacı, sonucu, kaynak ihtiyacı, sorumluluk etkisi ve sistem bütünlüğü değerlendirildi.',
    ],
    [
      'planning-review',
      'Planların gerçekleşmesi ve etkinliği izlendi',
      'Geciken veya etkisiz aksiyonlar için gerekçe, yeni karar ve revize termin kaydı oluşturuldu.',
    ],
  ),
  '6.1': checklist(
    [
      'risk-identification',
      'Süreç ve proje riskleri tanımlandı',
      'Kalite hedefini, sözleşme şartını, teslimi veya müşteri memnuniyetini etkileyebilecek riskler kayıt altına alındı.',
    ],
    [
      'risk-evaluation',
      'Riskler olasılık ve etkiye göre değerlendirildi',
      'Kullanılan puanlama yöntemi tutarlı; kabul, azaltma, paylaşma veya kaçınma kararı gerekçeli.',
    ],
    [
      'opportunities',
      'İyileştirme fırsatları belirlendi',
      'Yeni teknoloji, tedarik yöntemi, süreç sadeleştirme veya müşteri deneyimi fırsatlarının beklenen faydası kaydedildi.',
    ],
    [
      'action-plan',
      'Risk ve fırsat aksiyon planı atandı',
      'Her önemli kayıt için kontrol, sorumlu, kaynak, termin ve beklenen sonuç tanımlandı.',
    ],
    [
      'process-integration',
      'Aksiyonlar ilgili süreçlere entegre edildi',
      'Kontroller prosedür, proje planı, kontrol formu, sözleşme veya günlük operasyon adımlarına işlendi.',
    ],
    [
      'effectiveness-review',
      'Aksiyon etkinliği ve kalan risk değerlendirildi',
      'Uygulama sonrası sonuç ölçüldü, kalan risk kabul edildi veya ek aksiyon başlatıldı.',
    ],
  ),
  '6.2': checklist(
    [
      'policy-alignment',
      'Hedefler kalite politikasıyla uyumlu',
      'Her hedef müşteri, uygunluk, süreç performansı veya sürekli iyileştirme taahhüdüne bağlandı.',
    ],
    [
      'measurable-target',
      'Hedefler ölçülebilir şekilde tanımlandı',
      'Gösterge, hesaplama yöntemi, veri kaynağı, başlangıç değeri, hedef değer ve dönem açıkça yazıldı.',
    ],
    [
      'owner-resources',
      'Hedef sahibi ve kaynakları belirlendi',
      'Sorumlu kişi veya departman, gerekli bütçe, ekip, araç ve yönetim desteği atandı.',
    ],
    [
      'action-timeline',
      'Hedef aksiyonları ve zaman planı hazırlandı',
      'Ara kilometre taşları, teslim tarihleri ve bağımlılıklar takip edilebilir biçimde kaydedildi.',
    ],
    [
      'monitoring-results',
      'Hedef gerçekleşmesi düzenli izleniyor',
      'Gerçekleşen değerler planlanan sıklıkta girildi; sapma ve eğilimler analiz edildi.',
    ],
    [
      'corrective-update',
      'Sapmalar için önlem alındı ve hedef güncellendi',
      'Hedefe ulaşılamadığında kök neden, düzeltme planı ve revizyon kararı belgelenerek paylaşıldı.',
    ],
  ),
  '6.3': checklist(
    [
      'change-request',
      'Değişiklik talebi ve amacı kaydedildi',
      'Talebin nedeni, kapsamı, beklenen faydası ve talep sahibi açıkça tanımlandı.',
    ],
    [
      'consequence-assessment',
      'Olası sonuçlar ve riskler değerlendirildi',
      'Müşteri, kalite, süre, maliyet, mevzuat, veri ve devam eden projeler üzerindeki etkiler analiz edildi.',
    ],
    [
      'system-integrity',
      'KYS bütünlüğünün korunması planlandı',
      'Değişen süreçlerin diğer prosedür, form, kontrol ve raporlarla bağlantısı doğrulandı.',
    ],
    [
      'resources-responsibilities',
      'Kaynak ve sorumluluk değişiklikleri belirlendi',
      'Yeni yetki, görev, eğitim, bütçe, sistem veya ekipman ihtiyacı atandı.',
    ],
    [
      'approval-communication',
      'Değişiklik onaylandı ve ilgili taraflara duyuruldu',
      'Yetkili onayı, yürürlük tarihi, etkilenen kişiler ve iletişim kanıtı saklandı.',
    ],
    [
      'post-change-review',
      'Uygulama sonrası doğrulama tamamlandı',
      'Değişikliğin amaçlanan sonucu verdiği kontrol edildi; sorunlar ve ek aksiyonlar kaydedildi.',
    ],
  ),
  '7': checklist(
    [
      'support-plan',
      'KYS destek ihtiyaçları planlandı',
      'İnsan, altyapı, bilgi, iletişim, eğitim ve doküman ihtiyaçları süreçlere göre belirlendi.',
    ],
    [
      'resource-adequacy',
      'Kaynakların yeterliliği doğrulandı',
      'Kritik görevlerin yürütülmesi için gereken kapasite, ekipman, yazılım ve çalışma ortamı sağlandı.',
    ],
    [
      'competence-control',
      'Yetkinlik ve eğitim kontrolleri uygulanıyor',
      'Görev şartları, yeterlilik kanıtları, gelişim planları ve eğitim etkinliği kayıtları güncel.',
    ],
    [
      'awareness-control',
      'Kalite farkındalığı sağlandı',
      'Çalışanlar politika, hedef, katkı, sorumluluk ve uygunsuzluğun sonuçlarını biliyor.',
    ],
    [
      'communication-control',
      'İç ve dış iletişim planı işletiliyor',
      'Ne, ne zaman, kiminle, nasıl ve kimin tarafından iletişim kurulacağı tanımlandı.',
    ],
    [
      'document-control',
      'Dokümante bilgi kontrol altında',
      'Oluşturma, onay, erişim, revizyon, saklama, yedekleme ve imha kontrolleri uygulanıyor.',
    ],
  ),
  '7.1': checklist(
    [
      'people-capacity',
      'Gerekli insan kaynağı ve kapasite sağlandı',
      'Süreçlerin etkin işletimi ve kontrolleri için sayı, görev dağılımı ve yedekleme ihtiyacı karşılandı.',
    ],
    [
      'infrastructure',
      'Altyapı yeterliliği ve bakımı doğrulandı',
      'Ofis, şantiye, araç, makine, donanım, yazılım ve iletişim sistemleri için bakım kayıtları güncel.',
    ],
    [
      'work-environment',
      'Uygun çalışma ortamı sağlandı',
      'Fiziksel, sosyal ve psikolojik çalışma koşulları ile düzen, temizlik ve güvenlik ihtiyaçları değerlendirildi.',
    ],
    [
      'monitoring-resources',
      'İzleme ve ölçme kaynakları uygun',
      'Kontrol ve test ekipmanlarının amaca uygunluğu, kalibrasyonu veya doğrulaması ve izlenebilirliği kanıtlandı.',
    ],
    [
      'organizational-knowledge',
      'Kurumsal bilgi korunuyor ve erişilebilir',
      'Proje deneyimleri, teknik standartlar, sözleşme bilgileri ve çalışan uzmanlığı kaybolmaya karşı güvence altında.',
    ],
    [
      'resource-gaps',
      'Kaynak eksikleri için aksiyon alındı',
      'Tespit edilen eksiklikler risk seviyesine göre sorumlu, bütçe ve terminle takip ediliyor.',
    ],
  ),
  '7.2': checklist(
    [
      'competence-criteria',
      'Görev bazlı yetkinlik kriterleri tanımlandı',
      'Eğitim, deneyim, teknik bilgi, lisans ve davranışsal yeterlilik şartları görev tanımlarında yer alıyor.',
    ],
    [
      'competence-evidence',
      'Çalışan yeterlilik kanıtları güncel',
      'Diploma, sertifika, lisans, özgeçmiş, deneyim ve iç değerlendirme kayıtları doğrulandı.',
    ],
    [
      'gap-analysis',
      'Yetkinlik açıkları değerlendirildi',
      'Mevcut yeterlilik ile görev şartı arasındaki fark ve iş kalitesine oluşturduğu risk kaydedildi.',
    ],
    [
      'development-action',
      'Eğitim veya gelişim aksiyonu tamamlandı',
      'Eğitim, mentorluk, görev gözetimi, işe alım veya görev değişikliği ihtiyacı planlandı ve uygulandı.',
    ],
    [
      'training-effectiveness',
      'Eğitim etkinliği değerlendirildi',
      'Sınav, gözlem, performans sonucu veya uygulama kontrolüyle öğrenmenin işe yansıdığı doğrulandı.',
    ],
    [
      'competence-review',
      'Yetkinlik kayıtları periyodik gözden geçirildi',
      'Görev, teknoloji, mevzuat veya süreç değişiklikleri sonrası kriter ve gelişim planları güncellendi.',
    ],
  ),
  '7.3': checklist(
    [
      'policy-awareness',
      'Kalite politikası çalışanlara açıklandı',
      'Çalışanların politikanın kendi işiyle ilişkisini anladığı görüşme, eğitim veya duyuru kaydıyla doğrulandı.',
    ],
    [
      'objective-awareness',
      'İlgili kalite hedefleri paylaşıldı',
      'Her ekip kendi göstergelerini, hedef değerini ve son gerçekleşme durumunu biliyor.',
    ],
    [
      'personal-contribution',
      "Çalışanların KYS'ye katkısı açıklandı",
      'Görevlerin ürün-hizmet uygunluğu, müşteri memnuniyeti ve süreç etkinliğine etkisi anlatıldı.',
    ],
    [
      'nonconformity-consequence',
      'Şartlara uymamanın sonuçları biliniyor',
      'Hata, gecikme, müşteri kaybı, yasal risk ve yeniden iş yapma sonuçları ilgili ekiplerle paylaşıldı.',
    ],
    [
      'role-awareness',
      'Kalite rolü ve bildirim kanalları biliniyor',
      'Çalışanlar uygunsuzluğu, riski, müşteri şikayetini veya iyileştirme önerisini kime ileteceğini biliyor.',
    ],
    [
      'awareness-refresh',
      'Farkındalık periyodik olarak yenilendi',
      'Yeni başlayan, görev değiştiren ve sahada çalışan ekipler için güncel farkındalık kaydı mevcut.',
    ],
  ),
  '7.4': checklist(
    [
      'communication-matrix',
      'İletişim matrisi güncel',
      'Ne, ne zaman, kiminle, hangi kanalla ve hangi sorumlu tarafından iletişim kurulacağı tanımlandı.',
    ],
    [
      'internal-communication',
      'İç iletişim kanalları etkin kullanılıyor',
      'Yönetim kararları, proje değişiklikleri, kalite uyarıları ve görevler ilgili çalışanlara zamanında iletildi.',
    ],
    [
      'customer-communication',
      'Müşteri iletişim sorumlulukları uygulanıyor',
      'Bilgilendirme, talep, sözleşme, teslim, şikayet ve kişisel veri iletişimleri kayıtlı ve onaylı kanallardan yapıldı.',
    ],
    [
      'provider-communication',
      'Tedarikçi ve taşeron iletişimi kayıtlı',
      'Teknik şartlar, revizyonlar, teslim kriterleri ve uygunsuzluk bildirimleri doğru taraflara ulaştırıldı.',
    ],
    [
      'authority-communication',
      'Resmi kurum iletişimleri takip ediliyor',
      'İzin, ruhsat, bildirim ve denetim yazışmaları sorumlu, tarih ve sonuç bilgisiyle saklandı.',
    ],
    [
      'communication-evidence',
      'Kritik iletişimlerin kanıtı ve etkinliği doğrulandı',
      'E-posta, tutanak, sistem kaydı veya teslim teyidi saklandı; yanıtlanmayan konular için eskalasyon uygulandı.',
    ],
  ),
  '7.5': checklist(
    [
      'document-register',
      'Doküman ve kayıt envanteri güncel',
      'KYS için gerekli iç ve dış dokümanlar; sahibi, türü, revizyonu ve saklama yeriyle listelendi.',
    ],
    [
      'identification-format',
      'Doküman kimliği ve formatı uygun',
      'Başlık, kod, tarih, revizyon, hazırlayan ve format bilgileri dokümanı açıkça tanımlıyor.',
    ],
    [
      'review-approval',
      'Doküman yayın öncesi incelendi ve onaylandı',
      'İçeriğin uygunluğu yetkili kişilerce doğrulandı; onay ve yürürlük tarihi kayıtlı.',
    ],
    [
      'access-version',
      'Erişim ve güncel sürüm kontrolü sağlandı',
      'İhtiyaç noktasında doğru sürüm erişilebilir; eski sürümlerin yanlışlıkla kullanımı engellendi.',
    ],
    [
      'storage-security',
      'Saklama, koruma ve yedekleme kontrolleri uygulanıyor',
      'Okunabilirlik, gizlilik, erişim yetkisi, veri bütünlüğü ve yedekleme şartları doğrulandı.',
    ],
    [
      'external-documents',
      'Dış kaynaklı dokümanlar kontrol altında',
      'Standart, mevzuat, proje çizimi, üretici talimatı ve müşteri dokümanlarının güncelliği izleniyor.',
    ],
    [
      'retention-disposal',
      'Saklama süresi ve imha yöntemi belirlendi',
      'Kayıtların yasal ve sözleşmesel saklama süreleri, arşiv sorumlusu ve güvenli imha yöntemi tanımlandı.',
    ],
  ),
  '8': checklist(
    [
      'operation-plan',
      'Operasyonel süreç planı onaylandı',
      'Ürün ve hizmet şartlarını karşılamak için faaliyetler, sıralama, sorumlular ve kontrol noktaları belirlendi.',
    ],
    [
      'requirements-confirmed',
      'Müşteri, teknik ve yasal şartlar doğrulandı',
      'Operasyona başlamadan önce geçerli gereklilikler ve kabul kriterleri ekip tarafından teyit edildi.',
    ],
    [
      'resources-competence',
      'Kaynak ve yetkinlikler hazır',
      'Personel, tedarik, altyapı, ekipman, doküman ve bütçe ihtiyacının karşılandığı doğrulandı.',
    ],
    [
      'operational-controls',
      'Operasyonel kontroller uygulanıyor',
      'Kontrol planı, yöntem, test, gözden geçirme ve onay adımları planlanan aşamalarda tamamlandı.',
    ],
    [
      'outsourced-interfaces',
      'Dış kaynaklı süreç ve devir noktaları kontrol edildi',
      'Tedarikçi, taşeron ve iç ekipler arasındaki şartlar, teslimler ve sorumluluklar doğrulandı.',
    ],
    [
      'change-control',
      'Operasyonel değişiklikler kontrollü yürütüldü',
      'Planlı veya beklenmeyen değişikliklerin etkisi incelendi; onay, iletişim ve ek kontrol kayıtları tutuldu.',
    ],
    [
      'operation-records',
      'Uygunluğu kanıtlayan operasyon kayıtları tamamlandı',
      'Kontrol, test, teslim, onay ve uygunsuzluk kayıtları izlenebilir ve erişilebilir durumda.',
    ],
  ),
  '8.1': checklist(
    [
      'work-plan',
      'İş veya proje uygulama planı hazırlandı',
      'İş adımları, sorumlular, süreler, bağımlılıklar ve gerekli dokümante bilgiler tanımlandı.',
    ],
    [
      'acceptance-criteria',
      'Ürün, hizmet ve süreç kabul kriterleri belirlendi',
      'Teknik şartname, sözleşme, çizim, numune veya kontrol formundaki ölçülebilir kriterler net.',
    ],
    [
      'resource-readiness',
      'Operasyon için kaynak hazırlığı doğrulandı',
      'Yetkin personel, malzeme, ekipman, ölçüm aracı ve çalışma alanı faaliyetten önce hazırlandı.',
    ],
    [
      'control-points',
      'Kontrol ve doğrulama noktaları uygulandı',
      'Ara kontrol, test, müşteri onayı veya yönetim onayı gereken aşamalar atlanmadan kaydedildi.',
    ],
    [
      'operational-risks',
      'Operasyonel risk kontrolleri devrede',
      'Gecikme, hata, kaynak kesintisi, yanlış teslim ve müşteri şartı riskleri için önlemler uygulandı.',
    ],
    [
      'planned-unplanned-change',
      'Planlı ve beklenmeyen değişiklikler gözden geçirildi',
      'Değişiklik sonucu, onayı, etkilenen kayıtlar ve olumsuz etkiyi azaltan aksiyonlar belgelendi.',
    ],
  ),
  '8.2': checklist(
    [
      'customer-contact',
      'Müşteri iletişim kanalları ve sorumluları tanımlı',
      'Ürün bilgisi, teklif, sözleşme, değişiklik, geri bildirim ve şikayet iletişimleri kayıt altına alınıyor.',
    ],
    [
      'stated-requirements',
      'Müşterinin belirttiği şartlar eksiksiz kaydedildi',
      'Daire, proje, özellik, fiyat, ödeme, teslim, tapu ve satış sonrası beklentileri doğrulandı.',
    ],
    [
      'unstated-requirements',
      'Amaçlanan kullanım için gerekli örtük şartlar değerlendirildi',
      'Müşteri belirtmemiş olsa da uygun kullanım, güvenlik, erişim ve teslim için gerekli şartlar ele alındı.',
    ],
    [
      'legal-requirements',
      'Yasal ve düzenleyici şartlar doğrulandı',
      'Sözleşme, kimlik, izin, tapu, vergi ve tüketiciye yönelik geçerli yükümlülükler kontrol edildi.',
    ],
    [
      'contract-review',
      'Teklif ve sözleşme şartları taahhüt öncesi gözden geçirildi',
      'Şirketin şartları karşılama kabiliyeti, teslim tarihi, fiyat ve özel vaatler yetkili kişi tarafından onaylandı.',
    ],
    [
      'requirement-differences',
      'Farklı veya belirsiz şartlar çözüldü',
      'Teklif, rezervasyon ve sözleşme arasındaki farklar müşteriyle netleştirilerek yazılı teyit alındı.',
    ],
    [
      'requirement-changes',
      'Şart değişiklikleri güncellendi ve duyuruldu',
      'Revize gereklilikler ilgili dokümanlara işlendi; satış, proje, finans ve teslim ekipleri bilgilendirildi.',
    ],
  ),
  '8.3': checklist(
    [
      'design-plan',
      'Tasarım ve geliştirme planı oluşturuldu',
      'Aşamalar, sorumluluklar, gözden geçirme, doğrulama, geçerli kılma ve müşteri katılımı tanımlandı.',
    ],
    [
      'design-inputs',
      'Tasarım girdileri yeterli ve çelişkisiz',
      'Fonksiyonel şartlar, performans, mevzuat, standartlar, önceki deneyimler ve riskler kaydedildi.',
    ],
    [
      'design-review',
      'Tasarım gözden geçirmeleri tamamlandı',
      'Mimari, statik, mekanik, elektrik, saha uygulanabilirliği ve müşteri şartları disiplinler arası incelendi.',
    ],
    [
      'verification-validation',
      'Doğrulama ve geçerli kılma faaliyetleri yapıldı',
      'Çıktıların girdileri karşıladığı ve nihai kullanım için uygun olduğu hesap, kontrol, numune veya testle kanıtlandı.',
    ],
    [
      'design-outputs',
      'Tasarım çıktıları uygulama için yeterli',
      'Çizim, şartname, metraj, kabul kriteri ve güvenli kullanım bilgileri doğru formatta onaylandı.',
    ],
    [
      'design-change',
      'Tasarım değişiklikleri kontrol edildi',
      'Revizyon nedeni, etki analizi, doğrulama, yetkili onayı ve sahaya dağıtım kaydı tamamlandı.',
    ],
  ),
  '8.4': checklist(
    [
      'provider-selection',
      'Tedarikçi ve taşeron seçim kriterleri uygulandı',
      'Teknik yeterlilik, deneyim, kapasite, kalite performansı, yasal belgeler ve ticari şartlar değerlendirildi.',
    ],
    [
      'control-level',
      'Dış tedarik kontrol seviyesi riske göre belirlendi',
      'Tedarik edilen işin nihai kaliteye etkisi ve sağlayıcının kontrol kabiliyeti dikkate alındı.',
    ],
    [
      'purchase-requirements',
      'Satın alma ve sözleşme şartları açıkça iletildi',
      'Teknik özellik, çizim, teslim, kontrol, personel yeterliliği, saha kuralı ve kabul kriterleri bildirildi.',
    ],
    [
      'incoming-verification',
      'Gelen ürün veya hizmet doğrulandı',
      'Malzeme, belge, miktar, sertifika, numune ve uygulama kalitesi kabul öncesi kontrol edildi.',
    ],
    [
      'provider-performance',
      'Sağlayıcı performansı izlendi',
      'Kalite, termin, uygunsuzluk, iletişim ve düzeltme performansı puanlandı ve sonuç sağlayıcıya bildirildi.',
    ],
    [
      'provider-nonconformity',
      'Tedarik uygunsuzlukları kapatıldı',
      'Red, ayırma, yeniden işleme, iade veya düzeltici faaliyet kararı ve sorumlusu kaydedildi.',
    ],
    [
      'provider-reevaluation',
      'Tedarikçi yeniden değerlendirmesi tamamlandı',
      'Dönemsel sonuçlara göre onaylı liste durumu, ek kontrol, askıya alma veya çıkarma kararı verildi.',
    ],
  ),
  '8.5': checklist(
    [
      'controlled-conditions',
      'Üretim ve hizmet kontrollü şartlarda yürütülüyor',
      'Onaylı çizim, şartname, iş programı, yöntem ve kabul kriterleri uygulama noktasında mevcut.',
    ],
    [
      'competent-people-equipment',
      'Yetkin personel ve uygun ekipman kullanıldı',
      'Kritik işler için görev yetkisi, ekipman uygunluğu ve ölçüm aracının geçerliliği doğrulandı.',
    ],
    [
      'identification-traceability',
      'Tanımlama ve izlenebilirlik sağlandı',
      'Proje, blok, daire, mahal, malzeme partisi, kontrol durumu ve uygulayan ekip kayıtlarla ilişkilendirildi.',
    ],
    [
      'customer-property',
      'Müşteri veya dış sağlayıcı mülkiyeti korundu',
      'Anahtar, belge, malzeme, ekipman ve kişisel veriler teslim alma, kullanım ve iade boyunca kontrol edildi.',
    ],
    [
      'preservation',
      'Ürün ve tamamlanmış işler korunuyor',
      'Taşıma, depolama, paketleme, temizlik, hasar önleme ve teslim öncesi muhafaza kontrolleri uygulandı.',
    ],
    [
      'post-delivery',
      'Teslim sonrası yükümlülükler planlandı',
      'Garanti, bakım, kusur giderme, müşteri desteği ve yasal sorumluluklar için kayıt ve sorumlu mevcut.',
    ],
    [
      'production-change',
      'Üretim veya hizmet değişiklikleri onaylandı',
      'Değişiklik etkisi incelendi; uygulayan, onaylayan ve gerekli ek kontroller kaydedildi.',
    ],
  ),
  '8.6': checklist(
    [
      'release-criteria',
      'Serbest bırakma ve teslim kabul kriterleri tanımlı',
      'Tamamlanma, kalite, güvenlik, işlev, belge ve müşteri şartlarına ait kriterler açıkça listelendi.',
    ],
    [
      'inspection-tests',
      'Planlanan kontrol ve testler tamamlandı',
      'Muayene, ölçüm, fonksiyon testi ve gerekli resmi kontrollerin sonuçları kabul kriterlerini karşılıyor.',
    ],
    [
      'snag-closure',
      'Eksik ve kusur listesi kapatıldı',
      'Açık işler giderildi, yeniden kontrol edildi ve kalan istisnalar yetkili onayına bağlandı.',
    ],
    [
      'required-documents',
      'Teslim için gerekli dokümanlar hazır',
      'Onay, sertifika, garanti, kullanım bilgisi, test raporu ve teslim formunun güncelliği doğrulandı.',
    ],
    [
      'authorized-release',
      'Serbest bırakma yetkili kişi tarafından onaylandı',
      'Ürün veya hizmet, gerekli kontroller tamamlanmadan ve onaylayan kişi izlenebilir olmadan teslim edilmedi.',
    ],
    [
      'release-record',
      'Serbest bırakma kanıtı saklandı',
      'Proje, blok, daire veya hizmet; tarih, sonuç, istisna ve onaylayan bilgisiyle kayıt altına alındı.',
    ],
  ),
  '8.7': checklist(
    [
      'identify-nonconformity',
      'Uygun olmayan çıktı açıkça tanımlandı',
      'Hata veya eksik iş; proje, konum, ürün, tarih, şart ve tespit eden kişiyle kayıt altına alındı.',
    ],
    [
      'containment',
      'İstenmeyen kullanım veya teslim engellendi',
      'Uygunsuz çıktı işaretlendi, ayrıldı, erişimi durduruldu veya ilgili kişilere uyarı gönderildi.',
    ],
    [
      'disposition',
      'Uygunsuzluk için karar verildi',
      'Düzeltme, yeniden işleme, red, iade, askıya alma veya şartlı kabul kararı yetkili kişi tarafından onaylandı.',
    ],
    [
      'customer-notification',
      'Gerekli müşteri ve taraf bildirimleri yapıldı',
      'Teslim edilmiş veya taahhüdü etkileyen uygunsuzluklarda iletişim, mutabakat ve taviz kaydı saklandı.',
    ],
    [
      'reverification',
      'Düzeltme sonrası uygunluk yeniden doğrulandı',
      'Aynı kabul kriterleriyle yapılan tekrar kontrolün sonucu ve kontrol eden kişi kaydedildi.',
    ],
    [
      'nonconformity-record',
      'Uygunsuzluk kaydı eksiksiz kapatıldı',
      'Uygunsuzluğun niteliği, yapılan işlem, verilen taviz, onaylayan ve kapanış kanıtı dosyada mevcut.',
    ],
  ),
  '9': checklist(
    [
      'measurement-framework',
      'Performans izleme çerçevesi tanımlandı',
      'Neyin, hangi yöntemle, ne zaman ve kim tarafından ölçüleceği süreç bazında belirlendi.',
    ],
    [
      'customer-satisfaction',
      'Müşteri algısı ve memnuniyeti izleniyor',
      'Anket, şikayet, teslim geri bildirimi, tekrar satış veya benzeri güvenilir kaynaklar değerlendirildi.',
    ],
    [
      'data-analysis',
      'Kalite verileri analiz edildi',
      'Uygunluk, süreç performansı, hedefler, riskler ve tedarikçi sonuçları için eğilim ve sapmalar çıkarıldı.',
    ],
    [
      'internal-audit',
      'İç tetkik programı uygulandı',
      'Planlanan kapsamlar bağımsız biçimde denetlendi; bulgu ve düzeltici faaliyetler takip edildi.',
    ],
    [
      'management-review',
      'Yönetimin gözden geçirmesi tamamlandı',
      'Gerekli girdiler değerlendirildi; iyileştirme, değişiklik ve kaynak kararları kayda alındı.',
    ],
    [
      'performance-actions',
      'Performans sonuçları aksiyona dönüştürüldü',
      'Hedef dışı değerler ve olumsuz eğilimler için sorumlu, termin ve etkinlik kontrolü belirlendi.',
    ],
  ),
  '9.1': checklist(
    [
      'measurement-plan',
      'İzleme ve ölçme planı güncel',
      'Ölçülecek konu, yöntem, kaynak, sıklık, sorumlu, kabul kriteri ve raporlama kanalı tanımlandı.',
    ],
    [
      'kpi-results',
      'KPI sonuçları hedeflerle karşılaştırıldı',
      'Güncel dönem sonuçları, önceki dönem eğilimi ve hedef sapması doğru veriyle gösterildi.',
    ],
    [
      'data-integrity',
      'Ölçüm verisinin güvenilirliği doğrulandı',
      'Kaynak, hesaplama, örneklem, ölçüm aracı ve veri giriş kontrolleri sonuçların geçerli olmasını sağlıyor.',
    ],
    [
      'satisfaction-analysis',
      'Müşteri memnuniyeti verileri analiz edildi',
      'Proje, teslim durumu, iletişim ve şikayet konularına göre sonuçlar ayrıştırıldı ve eğilimler belirlendi.',
    ],
    [
      'conformity-process',
      'Ürün-hizmet uygunluğu ve süreç etkinliği değerlendirildi',
      'Kontrol sonuçları, hata oranı, yeniden iş, teslim performansı ve hedef gerçekleşmesi incelendi.',
    ],
    [
      'provider-analysis',
      'Tedarikçi performansı değerlendirildi',
      'Kalite, zamanında teslim, uygunsuzluk ve aksiyon kapatma verileri karar vermek için kullanıldı.',
    ],
    [
      'analysis-decisions',
      'Analiz sonuçları karar ve iyileştirmeye dönüştürüldü',
      'Risk, fırsat, kaynak, süreç değişikliği veya düzeltici faaliyet kararlarının dayandığı veri kaydedildi.',
    ],
  ),
  '9.2': checklist(
    [
      'audit-program',
      'Risk temelli iç tetkik programı hazırlandı',
      'Süreç önemi, değişiklikler, önceki sonuçlar, kapsam, sıklık ve yöntem dikkate alındı.',
    ],
    [
      'scope-criteria',
      'Tetkik kapsamı ve kriterleri tanımlandı',
      'İlgili standart maddeleri, iç prosedürler, lokasyon, dönem ve örneklem tetkik öncesi belirlendi.',
    ],
    [
      'auditor-impartiality',
      'Tetkikçi yetkinliği ve tarafsızlığı doğrulandı',
      'Tetkikçi kendi işini denetlemiyor; gerekli bilgi, deneyim ve yetkiye sahip.',
    ],
    [
      'objective-evidence',
      'Objektif tetkik kanıtları toplandı',
      'Görüşme, gözlem, doküman ve kayıt örnekleri bulguları destekleyecek şekilde kaydedildi.',
    ],
    [
      'findings-report',
      'Bulgular açık ve izlenebilir raporlandı',
      'Uygunluk, uygunsuzluk ve iyileştirme fırsatları şart, kanıt, süreç ve sorumluyla ilişkilendirildi.',
    ],
    [
      'corrective-followup',
      'Düzeltme ve düzeltici faaliyetler takip edildi',
      'Kök neden, aksiyon, termin ve etkinlik kontrolü tamamlanmadan bulgu kapatılmadı.',
    ],
    [
      'audit-records',
      'Tetkik kayıtları tamamlandı',
      'Program, plan, katılımcılar, checklist, kanıt, rapor ve kapanış doğrulaması erişilebilir durumda.',
    ],
  ),
  '9.3': checklist(
    [
      'review-plan',
      'Yönetim gözden geçirme planı ve katılımcıları belirlendi',
      'Toplantı tarihi, gündem, veri sahipleri ve karar yetkisine sahip katılımcılar önceden tanımlandı.',
    ],
    [
      'previous-actions',
      'Önceki yönetim kararlarının durumu incelendi',
      'Tamamlanan, geciken ve etkisiz aksiyonlar kanıtlarıyla değerlendirildi.',
    ],
    [
      'context-inputs',
      'Bağlam ve ilgili taraf değişiklikleri değerlendirildi',
      "Stratejik yönü veya KYS'yi etkileyen iç-dış konular ve yeni şartlar gündeme alındı.",
    ],
    [
      'performance-inputs',
      'Kalite performans girdileri eksiksiz sunuldu',
      'Müşteri memnuniyeti, hedefler, süreç sonuçları, uygunsuzluklar, tetkikler ve tedarikçi performansı incelendi.',
    ],
    [
      'resources-risks',
      'Kaynak yeterliliği ile risk ve fırsatlar gözden geçirildi',
      'Kaynak açığı, risk aksiyonu etkinliği ve yeni fırsatlar için yönetim kararı oluşturuldu.',
    ],
    [
      'review-outputs',
      'Toplantı çıktıları somut kararlara dönüştürüldü',
      'İyileştirme, KYS değişikliği ve kaynak ihtiyacı için sorumlu, termin ve beklenen sonuç belirlendi.',
    ],
    [
      'minutes-communication',
      'Toplantı tutanağı onaylandı ve paylaşıldı',
      'Kararlar, gerekçeler, katılımcılar ve takip yöntemi kayıt altına alınarak ilgili süreç sahiplerine iletildi.',
    ],
  ),
  '10': checklist(
    [
      'improvement-sources',
      'İyileştirme kaynakları düzenli değerlendiriliyor',
      'Veri analizi, şikayet, tetkik, uygunsuzluk, çalışan önerisi ve yönetim kararları birlikte incelendi.',
    ],
    [
      'customer-future-needs',
      'Mevcut ve gelecekteki müşteri ihtiyacı ele alındı',
      'Ürün-hizmeti geliştirecek veya olumsuz etkiyi önleyecek fırsatlar müşteri değeri açısından değerlendirildi.',
    ],
    [
      'nonconformity-system',
      'Uygunsuzluk ve düzeltici faaliyet sistemi işletiliyor',
      'Sorunlar kontrol altına alınıyor, kök neden analiz ediliyor ve tekrarını önleyen aksiyonlar izleniyor.',
    ],
    [
      'continual-improvement',
      'Sürekli iyileştirme faaliyetleri planlı yürütülüyor',
      'Uygunluk, yeterlilik ve etkinliği artıran çalışmalar hedef ve ölçüm sonuçlarıyla takip ediliyor.',
    ],
    [
      'effectiveness',
      'İyileştirme etkinliği doğrulandı',
      'Önce-sonra verileri, müşteri sonucu veya süreç göstergesi amaçlanan faydanın oluştuğunu gösteriyor.',
    ],
    [
      'standardization',
      'Başarılı iyileştirmeler standartlaştırıldı',
      'Prosedür, kontrol listesi, eğitim ve sistem ayarları güncellenerek kazanımın kalıcı olması sağlandı.',
    ],
  ),
  '10.1': checklist(
    [
      'immediate-correction',
      'Uygunsuzluk kontrol altına alındı ve düzeltildi',
      'Etkilenen çıktı güvenceye alındı; acil düzeltme ve oluşan sonuçlarla başa çıkma adımları kaydedildi.',
    ],
    [
      'root-cause',
      'Kök neden analizi tamamlandı',
      'Sorunun neden oluştuğu veri ve kanıtla analiz edildi; yalnızca belirtiyi gideren açıklamayla yetinilmedi.',
    ],
    [
      'similar-risk',
      'Benzer uygunsuzlukların varlığı veya oluşma ihtimali incelendi',
      'Diğer proje, daire, süreç, tedarikçi veya kayıtlarda aynı nedenin etkisi araştırıldı.',
    ],
    [
      'corrective-action',
      'Düzeltici faaliyet planlandı ve tamamlandı',
      'Kök nedeni ortadan kaldıran aksiyon, sorumlu, kaynak ve termin ile takip edildi.',
    ],
    [
      'effectiveness-check',
      'Düzeltici faaliyet etkinliği doğrulandı',
      'Belirlenen izleme döneminde tekrar oluşmadığı ve performansın beklenen seviyeye geldiği kanıtlandı.',
    ],
    [
      'system-updates',
      'Riskler ve KYS dokümanları güncellendi',
      'Gerekli risk kaydı, prosedür, kontrol formu, eğitim veya tedarik şartı revize edildi.',
    ],
    [
      'closure-record',
      'Uygunsuzluk kapanış kaydı onaylandı',
      'Uygunsuzluk, neden, aksiyon, sonuç, etkinlik kanıtı ve kapatan yetkili eksiksiz kaydedildi.',
    ],
  ),
  '10.2': checklist(
    [
      'improvement-backlog',
      'Sürekli iyileştirme listesi güncel',
      'Performans, müşteri, çalışan, tetkik ve risk kaynaklı geliştirme fikirleri tek listede izleniyor.',
    ],
    [
      'data-priority',
      'İyileştirme önceliği veriye göre belirlendi',
      'Beklenen kalite etkisi, müşteri değeri, maliyet, risk ve uygulanabilirlik puanlandı.',
    ],
    [
      'pdca-plan',
      'PUKÖ esaslı uygulama planı hazırlandı',
      'Mevcut durum, hedef, sorumlu, kaynak, adımlar, ölçüm ve gözden geçirme tarihi tanımlandı.',
    ],
    [
      'pilot-implementation',
      'Pilot veya kontrollü uygulama tamamlandı',
      'Değişiklik sınırlı kapsamda denenerek olumsuz etkiler ve gerçek sonuçlar gözlemlendi.',
    ],
    [
      'benefit-measurement',
      'İyileştirme faydası ölçüldü',
      'Önce-sonra verileriyle kalite, süre, maliyet, hata veya memnuniyet etkisi doğrulandı.',
    ],
    [
      'sustainment',
      'Kazanım yaygınlaştırıldı ve sürdürülebilirliği izlendi',
      'Başarılı yöntem standart işe, eğitime ve periyodik performans kontrolüne dahil edildi.',
    ],
  ),
  '10.3': checklist(
    [
      'opportunity-capture',
      'İyileştirme fırsatı açıkça tanımlandı',
      'Sorun, ihtiyaç veya potansiyel fayda; kaynağı ve etkilenen süreçle birlikte kaydedildi.',
    ],
    [
      'value-assessment',
      'Fırsatın değeri ve uygulanabilirliği değerlendirildi',
      'Müşteri, kalite, süre, gelir-gider, kaynak, teknoloji ve risk etkileri karşılaştırıldı.',
    ],
    [
      'priority-decision',
      'Öncelik ve uygulama kararı verildi',
      'Uygula, pilotla, beklet veya reddet kararı yetkili kişi ve gerekçesiyle kaydedildi.',
    ],
    [
      'sponsor-owner',
      'Sponsor, sorumlu ve kaynaklar atandı',
      'Kararı ilerletecek yönetici, uygulama sahibi, ekip, bütçe ve hedef tarih belirlendi.',
    ],
    [
      'opportunity-result',
      'Fırsat uygulama sonucu ölçüldü',
      'Beklenen ve gerçekleşen fayda karşılaştırıldı; yan etkiler ile öğrenilen dersler kaydedildi.',
    ],
    [
      'portfolio-review',
      'Fırsat portföyü düzenli gözden geçirildi',
      'Geciken, değeri değişen veya tamamlanan fırsatlar için yeni karar ve kapanış kaydı oluşturuldu.',
    ],
  ),
  İNŞAAT: checklist(
    [
      'land-permits',
      'Arsa, imar, ruhsat ve izin hazırlıkları tamamlandı',
      'Mülkiyet, imar koşulları, proje izinleri, resmi başvurular ve geçerlilik tarihleri proje dosyasında doğrulandı.',
    ],
    [
      'project-brief',
      'Proje ihtiyaç programı ve kalite hedefleri onaylandı',
      'Daire tipleri, kullanım şartları, teknik seviye, bütçe, süre ve müşteri vaadi tasarım girdisine dönüştürüldü.',
    ],
    [
      'design-coordination',
      'Tasarım disiplinleri koordine edildi',
      'Mimari, statik, mekanik, elektrik ve peyzaj projeleri çakışma, uygulanabilirlik ve mevzuat açısından kontrol edildi.',
    ],
    [
      'approved-drawings',
      'Onaylı çizim, şartname ve metraj sahada güncel',
      'Revizyon dağıtımı yapıldı; eski dokümanların kullanımının önlendiği ve kritik detayların ekipçe anlaşıldığı doğrulandı.',
    ],
    [
      'contractor-readiness',
      'Taşeron ve tedarikçi yeterliliği doğrulandı',
      'Sözleşme, teknik yeterlilik, ekip, program, kalite planı, iş güvenliği ve numune onayları işe başlamadan tamamlandı.',
    ],
    [
      'material-control',
      'Malzeme onay ve giriş kontrolleri tamamlandı',
      'Marka-model, sertifika, numune, miktar, hasar ve depolama şartları onaylı teknik gerekliliklerle karşılaştırıldı.',
    ],
    [
      'method-inspection-plan',
      'İş yöntemi ve muayene-test planı uygulandı',
      'Kritik imalat adımları, bekleme noktaları, toleranslar, örnekleme ve kabul kriterleri kontrol formlarında izlendi.',
    ],
    [
      'site-quality',
      'Saha imalat kalite kontrolleri eksiksiz',
      'Gizli işler kapanmadan kontrol edildi; fotoğraf, ölçüm, konum, uygulayan ekip ve kontrol eden kişi kayıtlı.',
    ],
    [
      'site-nonconformity',
      'Saha uygunsuzlukları ve eksik işler kapatıldı',
      'Düzeltme, kök neden, tekrar kontrol ve sorumlu onayı tamamlanmadan iş bir sonraki aşamaya geçirilmedi.',
    ],
    [
      'progress-asbuilt',
      'İlerleme ve uygulama sonrası dokümanları güncel',
      'Gerçekleşen imalat, metraj, revizyon, hakediş ve as-built çizimler saha durumuyla uyumlu.',
    ],
    [
      'testing-commissioning',
      'Sistem testleri ve devreye alma tamamlandı',
      'Elektrik, su, mekanik, yangın ve diğer sistemlerin fonksiyon testleri sonuçları ve eksik kapanışları mevcut.',
    ],
    [
      'handover-readiness',
      'Geçici-kesin kabul ve teslim dosyası hazır',
      'Daire ve ortak alan kontrolleri, temizlik, anahtar, sayaç, garanti, kullanım bilgisi ve teslim tutanakları tamamlandı.',
    ],
  ),
  SATIŞ: checklist(
    [
      'approved-inventory',
      'Güncel unit envanteri, fiyat ve satış şartları doğrulandı',
      'Proje, blok, daire, tip, durum, fiyat, para birimi, ödeme planı ve kampanya bilgisi yetkili onayına dayanıyor.',
    ],
    [
      'marketing-approval',
      'Pazarlama içerikleri doğru ve onaylı',
      'Görsel, plan, özellik, teslim vaadi ve fiyat ifadeleri güncel proje ve sözleşme şartlarıyla tutarlı.',
    ],
    [
      'lead-consent',
      'Müşteri kaynağı ve iletişim izni kaydedildi',
      "Lead kaynağı, iletişim tercihleri, dil, kişisel veri izinleri ve sorumlu satış temsilcisi CRM'de güncel.",
    ],
    [
      'needs-analysis',
      'Müşteri ihtiyaç analizi tamamlandı',
      'Bütçe, amaç, daire tipi, proje, ödeme kabiliyeti, teslim beklentisi ve karar kriterleri kayıt altına alındı.',
    ],
    [
      'presentation-record',
      'Sunum, görüşme ve takip kayıtları tamamlandı',
      "Paylaşılan projeler, unitler, teklifler, müşteri geri bildirimi, sonraki aksiyon ve tarih CRM'de izlenebilir.",
    ],
    [
      'availability-reservation',
      'Unit uygunluğu ve rezervasyon çakışması kontrol edildi',
      'Satış öncesi güncel sahiplik, iptal, rezervasyon süresi ve başka teklif durumu sistemden doğrulandı.',
    ],
    [
      'identity-compliance',
      'Kimlik ve zorunlu müşteri belgeleri doğrulandı',
      'Ad-soyad, uyruk, kimlik/pasaport, iletişim, adres ve gerekli uyum belgeleri doğru kişiyle eşleştirildi.',
    ],
    [
      'offer-approval',
      'Teklif, indirim ve özel şartlar onaylandı',
      'Fiyat, kur, ödeme vadeleri, dahil-hariç kalemler ve satış temsilcisi vaadi yetki limitlerine uygun.',
    ],
    [
      'contract-signature',
      'Sözleşme gözden geçirildi ve eksiksiz imzalandı',
      'Taraflar, unit, bedel, ödeme planı, teslim, fesih ve ekler tutarlı; imza ve tarih alanları tamamlandı.',
    ],
    [
      'payment-handoff',
      'Ödeme planı ve muhasebe devri tamamlandı',
      'Tahsilat takvimi, para birimi, ödeme kanalı, makbuz ve gecikme takibi müşteri-unit kaydıyla ilişkilendirildi.',
    ],
    [
      'deed-handover',
      'Tapu ve fiziksel teslim hazırlığı tamamlandı',
      'Borç, belge, hazır olma, anahtar, sayaç ve müşteri bilgilendirmeleri ilgili ekiplerle koordine edildi.',
    ],
    [
      'after-sales-transfer',
      'Satış sonrası ekip devri ve müşteri takibi yapıldı',
      'Müşteri, unit, iletişim geçmişi, açık talep, şikayet, garanti ve özel taahhütler satış sonrası ekibe aktarıldı.',
    ],
  ),
};

export function defaultQualityChecklistId(cardCode: string, key: string) {
  const cardSlug = cardCode
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return `qc-default-${cardSlug}-${key}`;
}
