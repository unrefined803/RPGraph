import type { SocialAppConfig } from './socialApps';
import fotogramBookshopRainUrl from '../../assets/social/fotogram/bookshop-rain.jpg';
import fotogramBrunchTableUrl from '../../assets/social/fotogram/brunch-table.jpg';
import fotogramCeramicClassUrl from '../../assets/social/fotogram/ceramic-class.jpg';
import fotogramCoastalDriveUrl from '../../assets/social/fotogram/coastal-drive.jpg';
import fotogramFarmersMarketUrl from '../../assets/social/fotogram/farmers-market.jpg';
import fotogramLakeRunUrl from '../../assets/social/fotogram/lake-run.jpg';
import fotogramMarketFindUrl from '../../assets/social/fotogram/market-find.jpg';
import fotogramParkPicnicUrl from '../../assets/social/fotogram/park-picnic.jpg';
import fotogramPastaNightUrl from '../../assets/social/fotogram/pasta-night.jpg';
import fotogramRooftopShowUrl from '../../assets/social/fotogram/rooftop-show.jpg';
import fotogramTrailViewUrl from '../../assets/social/fotogram/trail-view.jpg';
import fotogramWaterfrontRideUrl from '../../assets/social/fotogram/waterfront-ride.jpg';
import fotogramWindowCatUrl from '../../assets/social/fotogram/window-cat.jpg';

type SocialComment = {
  id: string;
  authorName?: string;
  authorHandle: string;
  text: string;
};

type DummyAuthor = {
  name: string;
  handle: string;
};

type DummyPostTemplate = {
  id: string;
  author: DummyAuthor;
  caption: string;
  likeCount: number;
  textOnly?: boolean;
  locked?: boolean;
  unlockPrice?: number;
  imageDataUrl?: string;
  comments: readonly Omit<SocialComment, 'id'>[];
};

function comment(authorName: string, authorHandle: string, text: string): Omit<SocialComment, 'id'> {
  return { authorName, authorHandle, text };
}

// The two platforms intentionally use separate, hand-written pools. The seeded
// selection below makes every character's starting feed feel individual while
// keeping it stable when the app is reopened.
export const dummyPostPools: Record<SocialAppConfig['id'], readonly DummyPostTemplate[]> = {
  fotogram: [
    {
      id: 'lake-run',
      author: { name: 'Luna Sky', handle: 'luna.sky' },
      caption: 'Dawn laps around the lake before the city wakes up. 🌤️',
      likeCount: 184,
      imageDataUrl: fotogramLakeRunUrl,
      comments: [
        comment('Riley Moon', 'rileymoon', 'This is the kind of morning I want.'),
        comment('Maya Brooks', 'mayabrooks', 'The light on the water is unreal.'),
        comment('Theo Jameson', 'theojameson', 'Save a lap for me next time!'),
        comment('Cleo Hart', 'cleohart', 'Okay, motivation restored.'),
      ],
    },
    {
      id: 'market-find',
      author: { name: 'Ari Blume', handle: 'ariblume' },
      caption: 'Found this little lamp at the Sunday market and I am obsessed.',
      likeCount: 96,
      imageDataUrl: fotogramMarketFindUrl,
      comments: [
        comment('Jordan Lee', 'jordansayshi', 'That is such a perfect find.'),
        comment('Sam Rivera', 'samrivera', 'Your apartment is going to look amazing.'),
        comment('Drew Parker', 'drewparker', 'Vintage shopping always wins.'),
        comment('Nia Cole', 'niacole', 'Please show us where you put it!'),
        comment('Riley Moon', 'rileymoon', 'The warm glow is everything.'),
      ],
    },
    {
      id: 'rooftop-show',
      author: { name: 'Max Power', handle: 'maxpower_official' },
      caption: 'Best seat in the house for a rooftop set tonight. 🎸',
      likeCount: 342,
      imageDataUrl: fotogramRooftopShowUrl,
      comments: [
        comment('Kit Harlow', 'kitharlow', 'That crowd looked electric.'),
        comment('Maya Brooks', 'mayabrooks', 'Still hearing that last song in my head.'),
        comment('Jules Martin', 'julesmartin', 'You captured the whole mood.'),
        comment('Theo Jameson', 'theojameson', 'Next time I am coming with you.'),
      ],
    },
    {
      id: 'brunch-table',
      author: { name: 'Nova Reyes', handle: 'nova.reyes' },
      caption: 'Long brunch, strong coffee, zero plans afterwards. ☕',
      likeCount: 128,
      imageDataUrl: fotogramBrunchTableUrl,
      comments: [
        comment('Cleo Hart', 'cleohart', 'This is my ideal Sunday.'),
        comment('Sam Rivera', 'samrivera', 'The pancakes deserve their own post.'),
        comment('Riley Moon', 'rileymoon', 'Coffee first, always.'),
        comment('Drew Parker', 'drewparker', 'That table looks so cozy.'),
        comment('Nia Cole', 'niacole', 'Saving this for weekend inspiration.'),
      ],
    },
    {
      id: 'trail-view',
      author: { name: 'Kit Harlow', handle: 'kitharlow' },
      caption: 'The climb was worth it for this view.',
      likeCount: 267,
      imageDataUrl: fotogramTrailViewUrl,
      comments: [
        comment('Jordan Lee', 'jordansayshi', 'That sky is incredible.'),
        comment('Lena Ford', 'lenaford', 'Adding this trail to my list.'),
        comment('Maya Brooks', 'mayabrooks', 'You make me want to go outside.'),
        comment('Theo Jameson', 'theojameson', 'Worth every step.'),
      ],
    },
    {
      id: 'bookshop-rain',
      author: { name: 'Sasha Vale', handle: 'sashavale' },
      caption: 'Rainy afternoon, a new novel, and nowhere else to be.',
      likeCount: 73,
      imageDataUrl: fotogramBookshopRainUrl,
      comments: [
        comment('Nia Cole', 'niacole', 'This is peak cozy.'),
        comment('Cleo Hart', 'cleohart', 'Please tell me the book is good.'),
        comment('Jules Martin', 'julesmartin', 'That bookstore corner is my favorite.'),
        comment('Sam Rivera', 'samrivera', 'I need a rainy-day reset too.'),
      ],
    },
    {
      id: 'ceramic-class',
      author: { name: 'Mina Park', handle: 'minapark' },
      caption: 'My first bowl is a little crooked, but it is mine. 🏺',
      likeCount: 154,
      imageDataUrl: fotogramCeramicClassUrl,
      comments: [
        comment('Drew Parker', 'drewparker', 'It has character!'),
        comment('Luna Sky', 'luna.sky', 'I love it, honestly.'),
        comment('Riley Moon', 'rileymoon', 'This makes me want to try pottery.'),
        comment('Lena Ford', 'lenaford', 'The glaze color is beautiful.'),
        comment('Jordan Lee', 'jordansayshi', 'Handmade is always better.'),
      ],
    },
    {
      id: 'coastal-drive',
      author: { name: 'Owen Reed', handle: 'owenreed' },
      caption: 'Windows down, no destination, playlist on repeat.',
      likeCount: 211,
      imageDataUrl: fotogramCoastalDriveUrl,
      comments: [
        comment('Theo Jameson', 'theojameson', 'This is exactly the plan.'),
        comment('Maya Brooks', 'mayabrooks', 'The ocean road never disappoints.'),
        comment('Cleo Hart', 'cleohart', 'Drop the playlist please.'),
        comment('Jules Martin', 'julesmartin', 'Take me with you next time.'),
      ],
    },
    {
      id: 'pasta-night',
      author: { name: 'Eden Moss', handle: 'edenmoss' },
      caption: 'Made pasta from scratch. The kitchen is a mess, but worth it.',
      likeCount: 119,
      imageDataUrl: fotogramPastaNightUrl,
      comments: [
        comment('Sam Rivera', 'samrivera', 'This looks restaurant-level.'),
        comment('Nia Cole', 'niacole', 'I can almost smell this through the screen.'),
        comment('Drew Parker', 'drewparker', 'Recipe, please!'),
        comment('Lena Ford', 'lenaford', 'The mess means it was made with love.'),
        comment('Riley Moon', 'rileymoon', 'Save me a bowl.'),
      ],
    },
    {
      id: 'window-cat',
      author: { name: 'Ivy Rowan', handle: 'ivyrowan' },
      caption: 'He has been watching birds for an hour and taking it very seriously.',
      likeCount: 301,
      imageDataUrl: fotogramWindowCatUrl,
      comments: [
        comment('Cleo Hart', 'cleohart', 'A professional bird critic.'),
        comment('Jordan Lee', 'jordansayshi', 'That tiny face!'),
        comment('Maya Brooks', 'mayabrooks', 'Please give him a treat from me.'),
        comment('Theo Jameson', 'theojameson', 'He is clearly on an important mission.'),
      ],
    },
    {
      id: 'park-picnic',
      author: { name: 'Maya Brooks', handle: 'mayabrooks' },
      caption: 'Golden hour, good snacks, and nowhere else to be. 🧺',
      likeCount: 238,
      imageDataUrl: fotogramParkPicnicUrl,
      comments: [
        comment('Nia Cole', 'niacole', 'This looks like the perfect afternoon.'),
        comment('Riley Moon', 'rileymoon', 'Save me a spot on the blanket!'),
        comment('Cleo Hart', 'cleohart', 'The golden light is so good.'),
        comment('Jules Martin', 'julesmartin', 'We need to do this again soon.'),
      ],
    },
    {
      id: 'farmers-market',
      author: { name: 'Jordan Lee', handle: 'jordansayshi' },
      caption: 'Came for tomatoes, left with half the market. 🥕',
      likeCount: 147,
      imageDataUrl: fotogramFarmersMarketUrl,
      comments: [
        comment('Sam Rivera', 'samrivera', 'Those vegetables look incredible.'),
        comment('Lena Ford', 'lenaford', 'A very successful market trip.'),
        comment('Drew Parker', 'drewparker', 'Fresh produce always gets me too.'),
        comment('Mina Park', 'minapark', 'Now I want to cook something colorful.'),
      ],
    },
    {
      id: 'waterfront-ride',
      author: { name: 'Lena Ford', handle: 'lenaford' },
      caption: 'Golden hour is better on two wheels. 🚲',
      likeCount: 276,
      imageDataUrl: fotogramWaterfrontRideUrl,
      comments: [
        comment('Luna Sky', 'luna.sky', 'That route looks beautiful.'),
        comment('Theo Jameson', 'theojameson', 'Perfect time of day for a ride.'),
        comment('Maya Brooks', 'mayabrooks', 'The skyline in that light!'),
        comment('Kit Harlow', 'kitharlow', 'Adding this to the weekend plan.'),
      ],
    },
    {
      id: 'dead-internet-theory',
      author: { name: 'Cleo Hart', handle: 'cleohart' },
      caption: 'Dead internet theory says most of this place is bots talking to bots. Anyway, hello to the six real people still scrolling. 👋',
      likeCount: 89,
      textOnly: true,
      comments: [
        comment('Theo Jameson', 'theojameson', 'Exactly what a bot would post.'),
        comment('Nia Cole', 'niacole', 'Can confirm, I failed three captchas today.'),
        comment('Jules Martin', 'julesmartin', 'Beep boop, nice theory.'),
        comment('Maya Brooks', 'mayabrooks', 'Still scrolling, so I guess I am real.'),
      ],
    },
    {
      id: 'nothing-is-real',
      author: { name: 'Theo Jameson', handle: 'theojameson' },
      caption: 'None of this is real anyway. The posts, the people, probably this coffee. Maybe it is all AI. Still tastes fine though.',
      likeCount: 112,
      textOnly: true,
      comments: [
        comment('Cleo Hart', 'cleohart', 'The coffee part is where you lost me.'),
        comment('Riley Moon', 'rileymoon', 'I feel real enough on weekdays.'),
        comment('Jordan Lee', 'jordansayshi', 'Please ask the simulation for better weather.'),
        comment('Sam Rivera', 'samrivera', 'Posting this was part of the algorithm.'),
      ],
    },
  ],
  onlyfriends: [
    {
      id: 'private-set',
      author: { name: 'Violet Lane', handle: 'violetlane' },
      caption: 'Tonight\'s private set is live. I saved the best frame for you. 🔒',
      likeCount: 842,
      locked: true,
      unlockPrice: 9.99,
      comments: [
        comment('Noah V', 'noahv', 'You knew exactly what you were doing with this one.'),
        comment('MiloAfterDark', 'miloafterdark', 'Worth unlocking in seconds.'),
        comment('Cassie R', 'cassier', 'The lighting is unreal.'),
        comment('Jay K', 'jayk', 'My favorite drop so far.'),
        comment('Amir S', 'amirs', 'Already waiting for the next set.'),
      ],
    },
    {
      id: 'midnight-glow',
      author: { name: 'Zara Quinn', handle: 'zaraquinn' },
      caption: 'A little after-dark glow from the studio. ✨',
      likeCount: 623,
      locked: true,
      unlockPrice: 7.49,
      comments: [
        comment('Luca M', 'lucam', 'This whole mood is dangerous.'),
        comment('Bea L', 'beal', 'You look incredible.'),
        comment('Rico F', 'ricof', 'The private feed is my favorite place to be.'),
        comment('Tess H', 'tessh', 'Okay, I am obsessed.'),
      ],
    },
    {
      id: 'mirror-check',
      author: { name: 'Cleo Noir', handle: 'cleonoir' },
      caption: 'Mirror check, no filters, just good music.',
      likeCount: 415,
      comments: [
        comment('Finn D', 'finnd', 'The confidence is everything.'),
        comment('Sienna W', 'siennaw', 'This is such a look.'),
        comment('Kai P', 'kaip', 'You always make simple feel special.'),
        comment('MiloAfterDark', 'miloafterdark', 'More of this energy, please.'),
        comment('Cassie R', 'cassier', 'Absolutely stunning.'),
      ],
    },
    {
      id: 'weekend-drop',
      author: { name: 'Romy Vale', handle: 'romyvale' },
      caption: 'Weekend drop is up early for my favorite people. 💌',
      likeCount: 734,
      locked: true,
      unlockPrice: 4.99,
      comments: [
        comment('Amir S', 'amirs', 'Starting the weekend the right way.'),
        comment('Tess H', 'tessh', 'The early access feels so special.'),
        comment('Noah V', 'noahv', 'You spoil us.'),
        comment('Bea L', 'beal', 'Instant mood boost.'),
      ],
    },
    {
      id: 'soft-morning',
      author: { name: 'Mara Lux', handle: 'maralux' },
      caption: 'Slow morning, soft light, and a little hello for the feed.',
      likeCount: 358,
      comments: [
        comment('Jay K', 'jayk', 'This is the calm I needed today.'),
        comment('Sienna W', 'siennaw', 'You make mornings look beautiful.'),
        comment('Luca M', 'lucam', 'That soft light is perfect.'),
        comment('Rico F', 'ricof', 'Starting my day with a smile now.'),
        comment('Finn D', 'finnd', 'Such a sweet post.'),
      ],
    },
    {
      id: 'voice-note',
      author: { name: 'Nia Velvet', handle: 'niavelvet' },
      caption: 'Left a little voice note for subscribers tonight.',
      likeCount: 291,
      locked: true,
      unlockPrice: 4.99,
      comments: [
        comment('Cassie R', 'cassier', 'That was such a lovely surprise.'),
        comment('Kai P', 'kaip', 'Your voice could fix any bad day.'),
        comment('MiloAfterDark', 'miloafterdark', 'Please do more of these.'),
        comment('Tess H', 'tessh', 'This felt so personal in the best way.'),
      ],
    },
    {
      id: 'studio-bonus',
      author: { name: 'Isla Rae', handle: 'islarae' },
      caption: 'A bonus from the studio floor because you asked nicely. 😉',
      likeCount: 679,
      locked: true,
      unlockPrice: 14.99,
      comments: [
        comment('Noah V', 'noahv', 'Best surprise all week.'),
        comment('Bea L', 'beal', 'You always deliver.'),
        comment('Amir S', 'amirs', 'The behind-the-scenes details are so good.'),
        comment('Finn D', 'finnd', 'This is why I stay subscribed.'),
        comment('Jay K', 'jayk', 'Completely worth it.'),
      ],
    },
    {
      id: 'night-out',
      author: { name: 'Demi Rose', handle: 'demirose' },
      caption: 'Dressed up with nowhere to rush to. Which look wins?',
      likeCount: 508,
      comments: [
        comment('Luca M', 'lucam', 'Every look wins.'),
        comment('Sienna W', 'siennaw', 'The second one is perfection.'),
        comment('Rico F', 'ricof', 'You could make anything look good.'),
        comment('Cassie R', 'cassier', 'The details are gorgeous.'),
      ],
    },
    {
      id: 'member-poll',
      author: { name: 'Avery Bloom', handle: 'averybloom' },
      caption: 'Members decide the next shoot: city lights or beach sunrise?',
      likeCount: 387,
      comments: [
        comment('Kai P', 'kaip', 'City lights, no question.'),
        comment('Tess H', 'tessh', 'Beach sunrise would be magical.'),
        comment('MiloAfterDark', 'miloafterdark', 'I voted city lights.'),
        comment('Bea L', 'beal', 'Either way will be beautiful.'),
        comment('Amir S', 'amirs', 'Please share the final poll result!'),
      ],
    },
    {
      id: 'late-coffee',
      author: { name: 'Suki Stone', handle: 'sukistone' },
      caption: 'Late coffee, loose plans, and a thank-you to everyone here.',
      likeCount: 244,
      comments: [
        comment('Jay K', 'jayk', 'Happy to be here.'),
        comment('Finn D', 'finnd', 'The appreciation goes both ways.'),
        comment('Noah V', 'noahv', 'This feels like catching up with a friend.'),
        comment('Sienna W', 'siennaw', 'Cheers to more late-night posts.'),
      ],
    },
  ],
};
