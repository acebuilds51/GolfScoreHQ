-- League banner photo (Pro branding): a course photo behind the league's name
-- at the top of its pages. Stored next to the logo in the league-logos bucket
-- (<league id>/banner-*.jpg), with the same upload rules.

alter table leagues
  add column banner_url text,
  add constraint leagues_banner_url_storage check (banner_url ~ '^https://[a-z0-9]+\.supabase\.co/storage/v1/object/public/league-logos/[0-9a-f-]{36}/[A-Za-z0-9._-]+$');

grant update (banner_url) on leagues to authenticated;

create or replace function enforce_branding_plan() returns trigger
language plpgsql as $$
begin
  if (new.logo_url is not null and new.logo_url is distinct from old.logo_url)
     or (new.banner_url is not null and new.banner_url is distinct from old.banner_url)
     or (new.brand_color is not null and new.brand_color is distinct from old.brand_color)
     or (new.accent_color is not null and new.accent_color is distinct from old.accent_color) then
    perform require_feature(new.id, 'branding', 'League logo and colors');
  end if;
  return new;
end $$;

drop trigger leagues_branding_plan on leagues;
create trigger leagues_branding_plan
before update of logo_url, banner_url, brand_color, accent_color on leagues
for each row execute function enforce_branding_plan();
