# PronounceAll — Kişisel Verilerin Korunması Kanunu (KVKK) Aydınlatma Metni (TASLAK)

**Durum:** Sahip incelemesi için TASLAK v0.1, 2026-09-17. Yayımlanmadı. Onaydan sonra
`/kvkk` adresinde sunulur (FR-CONSENT-05). Yayından önce hukuk bilgisine sahip bir kişi
tarafından gözden geçirilir.
**Kaynak:** Bu metin, İngilizce Gizlilik Politikası taslağıyla
(`PronounceAll_Privacy_Policy_EN_DRAFT.md`) aynı olgulardan hazırlanmıştır ve onunla
eşdeğer tutulmalıdır. **[SAHİP]** işaretli alanlar şartnamelerde belirlenmemiş
bilgilerdir. **[HESAPLAR]** işaretli bölümler, 4. yinelemede açılacak kayıtlı hesaplara
aittir ve hesaplar kullanıma sunulana kadar yayımlanan metinde yer almaz.

---

Bu aydınlatma metni, 6698 sayılı Kişisel Verilerin Korunması Kanunu'nun ("KVKK") 10.
maddesi uyarınca, PronounceAll (pronounceall.com) hizmetini kullanırken işlenen kişisel
verileriniz hakkında sizi bilgilendirmek amacıyla hazırlanmıştır.

## 1. Veri sorumlusu

**[SAHİP: ad soyad veya tüzel kişi unvanı, açık adres]**

İletişim: **[SAHİP: e-posta adresi]**

## 2. İşlenen kişisel veriler ve işleme amaçları

### 2.1 `pa_uid` tanımlayıcısı

Tarayıcınızda bir çerezde ve `localStorage` alanında saklanan, sizinle ilgili hiçbir
bilgi içermeyen rastgele bir tanımlayıcıdır (UUID sürüm 4). Sayfaları okumak sizinle
ilgili bir veritabanı kaydı oluşturmaz; bir kayıt (anonim ilerleme profili) yalnızca ilk
kez bir kelimeyi veya sesi kaydettiğinizde oluşturulur.

**Amaç:** Kaydettiğiniz kelimelerin ve seslerin tarayıcınızla ilişkili kalmasını
sağlamak.

### 2.2 Öğrenme etkinliğiniz (yalnızca öğrenme özelliklerini kullanmaya başladıktan sonra)

Bir kelimeyi veya sesi kaydettiğinizde, etiketlediğinizde ya da kaldırdığınızda bu
işlemi, ilgili kelimeyi veya sesi ve zamanını kaydederiz. Bu geçmişten her kelime ve ses
için güncel durumunuzu (kaydedildi, öğreniliyor, öğrenildi) tutarız. İlerleme profili,
oluşturulma ve son kullanılma zamanını da içerir.

Bir ilerleme profiliniz olduktan sonra ayrıca şunları kaydederiz:

- **Dinleme.** Bir kelimenin veya sesin kaydı gerçekten çalmaya başladığında, hangi
  kelime veya ses olduğunu ve zamanını.
- **Kelime karşılaşmaları.** Bir kelimenin sayfasını açtığınızda, o sözlük girdisinin iç
  tanımlayıcısını ve zamanını; **her kelime için takvim günü (UTC) başına en fazla bir
  kez**. Bu geçmiş, PronounceAll'ın ileride aradığınız kelimeleri tekrar için size geri
  getirmesini sağlar.

Bu kayıtlarda **bulunmayanlar:** arama kutusuna yazdığınız metin, sonuç bulunamayan
aramalar, geldiğiniz sayfa (yönlendiren), IP adresiniz ve başka herhangi bir serbest
metin. Yalnızca sayfa okuyan ve hiçbir şey kaydetmemiş bir kişinin öğrenme geçmişi
yoktur; açtığı kelimeler de kaydedilmez.

**Amaç:** İlerlemenizi göstermek, öğrendiklerinizi tekrar etmenizi sağlamak ve
PronounceAll'ın ilerideki sürümlerinde aradığınız kelimeleri kişiselleştirilmiş tekrar
için size geri getirmek. Bu geçmiş reklam, pazarlama amaçlı profilleme veya analiz için
kullanılmaz.

### 2.3 Kelime talepleri

Eksik bir kelimenin eklenmesini istediğinizde kelimeyi, dil türünü ve `pa_uid`
tanımlayıcınızı saklarız; böylece tekrarlanan talepler bir kez sayılır. Form başka bir
bilgi istemez ve Cloudflare Turnstile ile korunur.

**Amaç:** Sözlüğe hangi kelimelerin ekleneceğine karar vermek.

### 2.4 İşletim kayıtları

- **Erişim kayıtları** (sunucumuzda ve Cloudflare'da): IP adresiniz, istenen adres
  (içindeki arama terimi dahil), zaman ve teknik istek ayrıntıları.
- **Uygulama kayıtları:** istenen sayfa (adresteki `?` işaretinden sonraki kısım
  hariç) ve teknik tanılama bilgileri; arama terimleri, IP adresiniz ve çerezleriniz
  kaydedilmez.

Arama sayfaları arama terimini adreste taşır (`/search?q=…`); bu nedenle arama terimi
yalnızca yukarıdaki, 30 gün saklanan erişim kayıtlarında yer alır ve ilerleme
profilinizle ilişkilendirilmez.

**Amaç:** Hizmeti işletmek, arızaları gidermek ve kötüye kullanıma karşı korumak.

### 2.5 [HESAPLAR] Hesap oluşturursanız

- **Kullanıcı adı** (herkese açık) ve giriş için:
  - e-posta ile: **e-posta adresiniz** ve **parola özetiniz** (parolanızı asla
    saklamayız); yeni bir parola, parolanın kendisi değil yalnızca SHA-1 özetinin ilk beş
    karakteri gönderilerek sızdırılmış parolalara karşı denetlenir;
  - Google ile: **e-posta adresiniz**, Google **hesap tanımlayıcınız** ve **profil
    resminizin adresi**.
- E-posta adresinizin doğrulanıp doğrulanmadığı ve zamanı.
- Oturum açıkken sunucularımızda tutulan bir **oturum**.
- Hizmetin onay istediği durumlarda **onay kayıtları**.
- Giriş yaptığınızda, daha önce kullandığınız `pa_uid` tanımlayıcısının öğrenme geçmişi
  hesabınıza bağlanır.

**Amaç:** Hesabı sağlamak ve ilerlemenizi cihazlar arasında korumak.

## 3. Toplama yöntemi ve hukuki sebep

Kişisel verileriniz, web sitesini kullanmanız sırasında elektronik ortamda, otomatik
yollarla ve sizin gönderdiğiniz formlar aracılığıyla toplanır.

**[SAHİP / hukuki inceleme — önerilir, şartnamelerde belirlenmemiştir]**

| İşleme | Önerilen hukuki sebep (KVKK md. 5/2) |
|---|---|
| `pa_uid` çerezi, kaydedilen kelime ve sesler, öğrenme geçmişi, dinleme ve kelime karşılaşmaları | (c) Kullanmakta olduğunuz öğrenme hizmetinin ifası için gerekli olması |
| Kelime talepleri | (f) Sözlüğü geliştirmeye yönelik meşru menfaat |
| İşletim ve erişim kayıtları, istek sınırlama, Turnstile | (f) Hizmeti işletme ve güvenliğini sağlamaya yönelik meşru menfaat |
| [HESAPLAR] Hesap verileri | (c) Hesabın sağlanması için gerekli olması |
| [HESAPLAR] Kişisel veri içermeyen silme kayıtları | (ç) Hukuki yükümlülük |

## 4. Saklama süreleri

| Veri | Süre |
|---|---|
| Bir hesaba bağlı olmayan anonim tanımlayıcının öğrenme geçmişi | 2 yıl kullanılmadığında silinir (çerezin azami ömrüyle aynı) |
| [HESAPLAR] Hesabın öğrenme geçmişi (anonim tanımlayıcıdan aktarılan geçmiş dahil) | Hesap silinene kadar |
| [HESAPLAR] Hesap verileri | Hesap silinene kadar |
| [HESAPLAR] Oturumlar | 30 dakika hareketsizlik, en fazla 12 saat |
| [HESAPLAR] E-posta doğrulama bağlantıları | 24 saat |
| [HESAPLAR] Parola sıfırlama bağlantıları | 1 saat |
| [HESAPLAR] Geçici silinmiş hesaplar | 30 gün, ardından kalıcı olarak silinir |
| Erişim kayıtları | 30 gün |
| Uygulama kayıtları | Başlangıçta 90 gün, sonra 30 gün |
| Yedekler | 30 gün günlük, 26 hafta haftalık; şifreli |
| Silme kayıtları (kişisel veri içermez) | Denetim amacıyla saklanır |

Verileriniz silindiğinde kelime talepleri, tanımlayıcınız kaldırılarak saklanmaya devam
eder.

## 5. Kişisel verilerin aktarıldığı kişiler ve aktarım amacı

Verilerinizi satmayız ve reklam amacıyla paylaşmayız. Aşağıdaki hizmet sağlayıcılar
verileri yalnızca gerektiği ölçüde ve bizim adımıza işler:

| Sağlayıcı | Veri | Amaç |
|---|---|---|
| Hetzner (AB'deki sunucular) | Sakladığımız tüm veriler | Barındırma |
| Cloudflare | IP adresi, istek ayrıntıları, Turnstile denetimi | Sitenin sunulması, saldırı ve bot koruması |
| Backblaze B2 | Şifreli veritabanı yedekleri | Kurtarma |
| [HESAPLAR] İşlemsel e-posta sağlayıcısı (Brevo, geçici) | E-posta adresiniz ve gönderdiğimiz bağlantı | Hesap e-postaları |
| [HESAPLAR] Google | Yalnızca "Google ile devam et" seçildiğinde | Giriş |
| [HESAPLAR] Have I Been Pwned | Parola özetinin ilk beş karakteri | Sızıntı denetimi |
| **[SAHİP]** Kullanılırsa hata izleme hizmeti | Kişisel verileri çıkarılmış hata tanılama bilgileri | Arızaların giderilmesi |

Sunucularımız Avrupa Birliği'ndedir. Bu, verilerinizin yurt dışına aktarılması anlamına
gelir. **[SAHİP / hukuki inceleme: KVKK md. 9 kapsamında yurt dışına aktarım dayanağı.]**

## 6. KVKK md. 11 kapsamındaki haklarınız

Bize başvurarak:

- kişisel verilerinizin işlenip işlenmediğini öğrenme,
- işlenmişse buna ilişkin bilgi talep etme,
- işlenme amacını ve amacına uygun kullanılıp kullanılmadığını öğrenme,
- yurt içinde veya yurt dışında aktarıldığı üçüncü kişileri bilme,
- eksik veya yanlış işlenmişse düzeltilmesini isteme,
- KVKK md. 7'de öngörülen şartlar çerçevesinde silinmesini veya yok edilmesini isteme,
- düzeltme ve silme işlemlerinin, verilerin aktarıldığı üçüncü kişilere bildirilmesini
  isteme,
- işlenen verilerin münhasıran otomatik sistemler vasıtasıyla analiz edilmesi suretiyle
  aleyhinize bir sonucun ortaya çıkmasına itiraz etme,
- kanuna aykırı işleme sebebiyle zarara uğramanız hâlinde zararın giderilmesini talep
  etme

haklarına sahipsiniz.

[HESAPLAR] Hesabınızı Ayarlar sayfasından silebilirsiniz. Geçici silme, 30 gün içinde
giriş yapılarak geri alınabilir; kalıcı silme hesabınızı ve öğrenme geçmişinizi 24 saat
içinde kalıcı olarak kaldırır.

Başvurularınızı **[SAHİP: e-posta adresi]** adresine iletebilirsiniz. Başvurunuzun
alındığını 3 iş günü içinde bildirir, en geç 30 gün içinde yanıtlarız. Verilerin size
ait olduğunu doğrulamak için bilgi isteyebiliriz. Başvurunuzun reddedilmesi, yanıtın
yetersiz bulunması veya süresinde yanıt verilmemesi hâlinde Kişisel Verileri Koruma
Kurulu'na şikâyette bulunabilirsiniz.

## 7. Çerezler

| Ad | Tür | Amaç | Süre |
|---|---|---|---|
| `pa_uid` | Zorunlu | Anonim ilerleme tanımlayıcısı | 2 yıl, kullanıldıkça yenilenir |
| `pa_sid` [HESAPLAR] | Zorunlu | Oturum | En fazla 12 saat, 30 dakika hareketsizlik |
| Cloudflare çerezleri | Zorunlu | Güvenlik ve bot koruması | Cloudflare'a göre |

Başka çerez kullanılmaz. Siteler arası istek sahteciliğine karşı koruma çerez değil,
her istekle gönderilen bir belirteç kullanır. Reklam çerezi yoktur.

**Son güncelleme:** [SAHİP: yayım tarihi]
